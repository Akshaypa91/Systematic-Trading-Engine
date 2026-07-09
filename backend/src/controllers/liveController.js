// src/controllers/liveController.js
'use strict';

const lts        = require('../services/liveTradingService');
const db         = require('../config/database');
const logger     = require('../config/logger');
const auditLog   = require('../middleware/auditLog');
const upstoxAuth = require('../services/upstoxAuth');
const upstoxWS   = require('../ws/upstoxWS');
const broker     = require('../services/brokerAdapter');

function uid(req) { return req.user?.userId ?? req.user?.id ?? null; }

// Safe number coercion for broker payloads (Upstox returns strings sometimes).
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── GET /api/live/broker/status ───────────────────────────────────────────────
// Rich status for the Broker Status Card. Never throws — every remote call is
// isolated so a single failing Upstox endpoint still returns partial data with
// `connected` reflecting the token/WS reality.
async function getBrokerStatus(req, res) {
  const userId    = uid(req);
  const tokenInfo = upstoxAuth.getTokenStatus();
  const wsStatus  = upstoxWS.getStatus();
  const connected = upstoxAuth.isAuthenticated();

  const out = {
    success:   true,
    connected,
    broker:    'Upstox',
    websocket: wsStatus,
    token:     tokenInfo,
    profile:   null,
    funds:     null,
    errors:    {},
  };

  if (!connected) return res.json(out);

  // Profile + funds fetched independently; failures are non-fatal.
  const [profileRes, fundsRes] = await Promise.allSettled([
    broker.getProfile(userId),
    broker.getFunds(userId),
  ]);

  if (profileRes.status === 'fulfilled') {
    const p = profileRes.value || {};
    out.profile = {
      clientId:    p.user_id  || null,
      accountName: p.user_name || null,
      email:       p.email || null,
      exchanges:   p.exchanges || [],
      products:    p.products || [],
      segment:     Array.isArray(p.exchanges) ? p.exchanges.join(', ') : (p.exchanges || null),
      userType:    p.user_type || null,
      isActive:    p.is_active !== false,
    };
  } else {
    out.errors.profile = profileRes.reason?.message || 'profile fetch failed';
  }

  if (fundsRes.status === 'fulfilled') {
    // Upstox funds shape: { equity: { available_margin, used_margin, ... }, commodity: {...} }
    const eq = fundsRes.value?.equity || fundsRes.value || {};
    out.funds = {
      available: num(eq.available_margin),
      used:      num(eq.used_margin),
      margin:    num(eq.used_margin),
      equity:    num(eq.available_margin) != null && num(eq.used_margin) != null
                   ? num(eq.available_margin) + num(eq.used_margin)
                   : num(eq.available_margin),
      collateral: num(eq.collateral),
      raw:        eq,
    };
  } else {
    out.errors.funds = fundsRes.reason?.message || 'funds fetch failed';
  }

  // connectionTime = when the WS connected (approx via token grant if WS lacks it)
  out.connectionTime = wsStatus?.connected ? (tokenInfo.grantedAt || null) : null;
  out.tokenExpiry    = tokenInfo.expiresAt || null;

  return res.json(out);
}

// ── POST /api/live/broker/reconnect ───────────────────────────────────────────
// Re-establish the Upstox market-data WS using the existing token.
async function brokerReconnect(req, res) {
  if (!upstoxAuth.isAuthenticated()) {
    return res.status(409).json({ success: false, error: 'No valid Upstox token — complete OAuth login first' });
  }
  try {
    upstoxWS.disconnect();
    await upstoxWS.connect();
    auditLog('live.broker_reconnect', req, { userId: uid(req) });
    return res.json({ success: true, websocket: upstoxWS.getStatus() });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/broker/disconnect ──────────────────────────────────────────
// Full broker logout: drop WS + clear token. Forces LIVE mode off (frontend
// gates on connection) so no live orders can be placed while disconnected.
async function brokerDisconnect(req, res) {
  try {
    upstoxWS.disconnect();
    upstoxAuth.clearToken();
    // Safety: force this user back to PAPER so a stale LIVE selection can't linger.
    await db.query(
      'UPDATE users SET trading_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['paper', uid(req)]
    );
    auditLog('live.broker_disconnect', req, { userId: uid(req) });
    return res.json({ success: true, connected: false, tradingMode: 'PAPER' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/broker/refresh ─────────────────────────────────────────────
// Re-fetch profile + funds (bypasses any client cache). Same payload as status.
async function brokerRefresh(req, res) {
  return getBrokerStatus(req, res);
}

// ── POST /api/live/order ──────────────────────────────────────────────────────
async function placeOrder(req, res) {
  const userId = uid(req);
  const { symbol, side, qty, price, orderType, confirmed, currentPrice } = req.body;

  if (!symbol || !side || !qty) {
    return res.status(400).json({ success: false, error: 'symbol, side, qty required' });
  }
  if (!['BUY','SELL'].includes(side.toUpperCase())) {
    return res.status(400).json({ success: false, error: 'side must be BUY or SELL' });
  }

  try {
    const result = await lts.placeOrder(userId, {
      symbol, side: side.toUpperCase(),
      qty: parseInt(qty, 10), price: price ? parseFloat(price) : null,
      orderType: orderType || 'MARKET',
      confirmed: !!confirmed,
      currentPrice: parseFloat(currentPrice || 0),
    });
    auditLog('live.order_placed', req, { userId, symbol, side: side.toUpperCase(), qty });
    return res.status(201).json(result);
  } catch (err) {
    logger.warn(`[LiveCtrl] placeOrder error: ${err.message} code=${err.code}`);
    return res.status(err.statusCode || 500).json({
      success: false, error: err.message, code: err.code,
    });
  }
}

// ── GET /api/live/positions ───────────────────────────────────────────────────
async function getPositions(req, res) {
  try {
    const data = await lts.getPositions(uid(req));
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/orders ──────────────────────────────────────────────────────
async function getOrders(req, res) {
  try {
    const data = await lts.getOrders(uid(req));
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/funds ───────────────────────────────────────────────────────
async function getFunds(req, res) {
  try {
    const data = await lts.getFunds(uid(req));
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── DELETE /api/live/order/:brokerOrderId ─────────────────────────────────────
async function cancelOrder(req, res) {
  try {
    const data = await lts.cancelOrder(uid(req), req.params.brokerOrderId);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/status ──────────────────────────────────────────────────────
async function getStatus(req, res) {
  const userId = uid(req);
  try {
    const [rows] = await db.query(
      `SELECT provider, is_active, linked_at FROM broker_accounts WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    const [modeRows] = await db.query(
      `SELECT trading_mode FROM users WHERE id = ? LIMIT 1`, [userId]
    );
    const [flag] = await db.query(
      "SELECT flag_value FROM system_flags WHERE flag_key='live_trading_enabled' LIMIT 1"
    );
    return res.json({
      success: true,
      brokerLinked:        !!rows[0]?.is_active,
      broker:              rows[0]?.provider || null,
      tradingMode:         modeRows[0]?.trading_mode || 'PAPER',
      killSwitch:          flag[0]?.flag_value === 'false',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/mode ── switch PAPER/LIVE ──────────────────────────────────
async function setMode(req, res) {
  const { mode } = req.body;
  if (!['PAPER','LIVE'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'mode must be PAPER or LIVE' });
  }
  await db.query(
    'UPDATE users SET trading_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [mode.toLowerCase(), uid(req)]
  );
  auditLog('live.mode_changed', req, { userId: uid(req), mode });
  return res.json({ success: true, mode });
}

// ── POST /api/live/admin/kill-switch (admin only) ─────────────────────────────
// Route-level requireAdmin (routes/live.js) is now the primary guard — this
// inline check is kept as defense-in-depth in case the route is ever
// re-wired without it.
async function killSwitch(req, res) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  const { enabled } = req.body;
  await lts.setKillSwitch(!!enabled);
  auditLog('live.kill_switch', req, { userId: uid(req), enabled: !!enabled });
  return res.json({ success: true, liveEnabled: !!enabled });
}

module.exports = {
  placeOrder, getPositions, getOrders, getFunds, cancelOrder, getStatus, setMode, killSwitch,
  getBrokerStatus, brokerReconnect, brokerDisconnect, brokerRefresh,
};
