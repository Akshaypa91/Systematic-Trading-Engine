// src/controllers/liveController.js
'use strict';

const lts        = require('../services/liveTradingService');
const db         = require('../config/database');
const logger     = require('../config/logger');
const auditLog   = require('../middleware/auditLog');
const upstoxAuth = require('../services/upstoxAuth');
const upstoxWS   = require('../ws/upstoxWS');
const broker     = require('../services/brokerAdapter');
const liveFeed   = require('../data/liveDataFeed');
const marketData = require('../services/marketDataService');
const positionTargets = require('../risk/positionTargets');

function uid(req) { return req.user?.userId ?? req.user?.id ?? null; }

// Safe number coercion for broker payloads (Upstox returns strings sometimes).
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── GET /api/live/broker/status ───────────────────────────────────────────────
// Rich status for the Broker Status Card. Never throws — every remote call is
// isolated so a single failing Upstox endpoint still returns partial data with
// `connected` reflecting the token/WS reality.
async function getBrokerStatus(req, res) {
  const userId    = uid(req);
  const wsStatus  = upstoxWS.getStatus();
  // "Connected" means connected FOR THIS USER. Reporting the raw process token
  // is what rendered another trader's client ID, name and ₹ balance inside a
  // different user's session — this card is exactly where the leak showed up.
  const connected = upstoxAuth.isOwnedBy(userId);
  const tokenInfo = connected ? upstoxAuth.getTokenStatus() : { hasToken: false };

  const out = {
    success:   true,
    connected,
    // Lets the UI say "someone else has linked a broker here" without exposing
    // one byte of whose, or what is in it.
    linkedByOther: upstoxAuth.isAuthenticated() && !connected,
    broker:    'Upstox',
    sandbox:   broker.isSandbox?.() || false,
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

  // Detect a token that exists locally but is REJECTED by Upstox (401/403).
  // This happens when the token expired or was superseded by a newer login.
  const statusOf = (r) => r?.reason?.response?.status;
  const rejected = [profileRes, fundsRes].some(r => r.status === 'rejected' && [401, 403].includes(statusOf(r)));

  if (rejected) {
    // The stored token is dead. Clear it so the UI shows a clean "Connect"
    // state and the next login starts fresh (a lingering dead token otherwise
    // reads as green "Connected" forever).
    upstoxAuth.clearToken();
    try { upstoxWS.disconnect(); } catch (_) {}
    return res.json({
      ...out,
      connected: false,
      tokenRejected: true,
      reason: 'Upstox rejected the saved session (401) — it expired or was replaced by a newer login. Please reconnect.',
    });
  }

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
    // Upstox locks the funds/margin endpoint (HTTP 423) during its nightly EOD
    // settlement window (~00:00–05:30 IST). Surface that clearly instead of a
    // raw status code.
    const st = fundsRes.reason?.response?.status;
    out.errors.funds = st === 423
      ? 'Funds temporarily unavailable — Upstox locks funds/margin during its nightly settlement (~12am–5:30am IST). Available in market hours.'
      : (fundsRes.reason?.message || 'funds fetch failed');
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
    try { require('../data/upstoxRestFeed').stop(); } catch (_) {}
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
  const {
    symbol, side, qty, price, orderType, confirmed, currentPrice,
    product, validity, triggerPrice, disclosedQty, isAmo,
  } = req.body;

  if (!symbol || !side || !qty) {
    return res.status(400).json({ success: false, error: 'symbol, side, qty required' });
  }
  if (!['BUY','SELL'].includes(String(side).toUpperCase())) {
    return res.status(400).json({ success: false, error: 'side must be BUY or SELL' });
  }

  try {
    const result = await lts.placeOrder(userId, {
      symbol, side: side.toUpperCase(),
      qty: parseInt(qty, 10),
      price: price ? parseFloat(price) : null,
      orderType:    orderType || 'MARKET',
      product:      product || 'CNC',
      validity:     validity || 'DAY',
      triggerPrice: triggerPrice ? parseFloat(triggerPrice) : 0,
      disclosedQty: disclosedQty ? parseInt(disclosedQty, 10) : 0,
      isAmo:        !!isAmo,
      confirmed:    !!confirmed,
      currentPrice: parseFloat(currentPrice || 0),
    });
    auditLog('live.order_placed', req, { userId, symbol, side: side.toUpperCase(), qty, orderType, product, sandbox: result.sandbox });
    return res.status(201).json(result);
  } catch (err) {
    logger.warn(`[LiveCtrl] placeOrder error: ${err.message} code=${err.code}`);
    return res.status(err.statusCode || 500).json({
      success: false, error: err.message, code: err.code,
    });
  }
}

// ── GET /api/live/diagnostics ── real-time market-data diagnostics ────────────
async function getDiagnostics(req, res) {
  try {
    const ws   = upstoxWS.getStatus();
    let rest = {};
    try { rest = require('../data/upstoxRestFeed').getStatus(); } catch (_) {}
    let instruments = {};
    try { instruments = require('../data/instrumentMaster').getStats(); } catch (_) {}
    // Active provider: WS ticks > REST poller ticks > nothing. There is no SIM
    // provider any more — with no broker session the honest answer is NONE, and
    // the UI renders delayed-close or empty states accordingly.
    let provider = 'NONE';
    if (ws.connected && ws.tickRate > 0)       provider = 'UPSTOX_WS';
    else if (rest.running && rest.tickRate > 0) provider = 'UPSTOX_REST';
    else if (upstoxAuth.isAuthenticated())      provider = 'UPSTOX/FALLBACK';
    // Process uptime makes host restarts visible. On a sleeping free-tier
    // instance this resets constantly — which also resets in-memory tick
    // counters and stops the OMS loop, so it must be obvious, not inferred.
    const uptimeSec = Math.round(process.uptime());
    return res.json({
      success:   true,
      brokerAuthenticated: upstoxAuth.isAuthenticated(),
      provider,
      process: {
        uptimeSec,
        startedAt: new Date(Date.now() - uptimeSec * 1000).toISOString(),
        recentlyRestarted: uptimeSec < 300,
      },
      // Measured reaction budget (feed staleness + signal compute + order RTT).
      latency:   (() => { try { return require('../utils/latencyMonitor').report(); } catch { return null; } })(),
      websocket: ws,
      restFeed:  rest,
      instruments,
      feed:      liveFeed.getStats?.() || {},
      cache:     marketData.getCacheStats?.() || {},
      // Watchlist symbols with no usable stored history, and why. Previously
      // these were invisible because the engine invented a series for them.
      dataGaps:  (() => { try { return require('../engine/simulationEngine').getUnavailable(); } catch { return []; } })(),
      ts:        new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/charges ── preview brokerage/taxes for the confirmation modal
async function getCharges(req, res) {
  const { symbol, side, qty, price, product } = req.body;
  if (!symbol || !side || !qty) {
    return res.status(400).json({ success: false, error: 'symbol, side, qty required' });
  }
  try {
    const charges = await lts.getCharges(uid(req), {
      symbol, side: String(side).toUpperCase(),
      qty: parseInt(qty, 10), price: parseFloat(price || 0),
      product: product || 'CNC',
    });
    return res.json({ success: true, charges });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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

// ── GET /api/live/execution-quality ──────────────────────────────────────────
// Reconciles fills (best-effort) then returns slippage analytics + a measured
// slippage estimate to feed the backtester.
async function getExecutionQuality(req, res) {
  try {
    try { await lts.reconcileFills(uid(req)); } catch (_) { /* best-effort */ }
    const data = await lts.getExecutionQuality(uid(req));
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── Exit-intent (SL/TP/trailing) targets monitored by the execution engine ────
async function getTargets(req, res) {
  try { return res.json({ success: true, data: await positionTargets.getActiveTargets(uid(req)) }); }
  catch (err) { return res.status(500).json({ success: false, error: err.message }); }
}
async function setTarget(req, res) {
  const { symbol, side, stopLoss, takeProfit, trailingPct } = req.body || {};
  if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
  if (stopLoss == null && takeProfit == null && trailingPct == null)
    return res.status(400).json({ success: false, error: 'provide at least one of stopLoss, takeProfit, trailingPct' });
  try {
    const data = await positionTargets.upsertTarget(uid(req), symbol, { side, stopLoss, takeProfit, trailingPct });
    auditLog('live.target_set', req, { userId: uid(req), symbol, stopLoss, takeProfit, trailingPct });
    return res.json({ success: true, data });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
}
async function clearTarget(req, res) {
  try {
    await positionTargets.deactivate(uid(req), req.params.symbol);
    auditLog('live.target_cleared', req, { userId: uid(req), symbol: req.params.symbol });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
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

// ── GET /api/live/funds/normalized ── cash/margin/collateral/buying power ──────
async function getFundsNormalized(req, res) {
  try {
    const data = await lts.getFundsNormalized(uid(req));
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/holdings ── portfolio holdings + allocation ─────────────────
async function getHoldings(req, res) {
  try {
    const data = await lts.getHoldings(uid(req));
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/positions/exit ── square off a single position ─────────────
async function exitPosition(req, res) {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
  try {
    const data = await lts.exitPosition(uid(req), symbol);
    auditLog('live.position_exit', req, { userId: uid(req), symbol });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

// ── POST /api/live/emergency/square-off ── exit ALL positions ─────────────────
async function squareOffAll(req, res) {
  try {
    const data = await lts.squareOffAll(uid(req));
    auditLog('live.square_off_all', req, { userId: uid(req), count: data.squaredOff });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/emergency/cancel-all ── cancel ALL open orders ─────────────
async function cancelAllOrders(req, res) {
  try {
    const data = await lts.cancelAllOrders(uid(req));
    auditLog('live.cancel_all', req, { userId: uid(req), count: data.cancelled });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/emergency/stop ── engage kill switch + square off + cancel ─
async function emergencyStop(req, res) {
  const userId = uid(req);
  try {
    await lts.setLiveTradingEnabled(false);   // halt live trading
    const cancelled = await lts.cancelAllOrders(userId).catch(e => ({ error: e.message }));
    const squared   = await lts.squareOffAll(userId).catch(e => ({ error: e.message }));
    // Force this user to PAPER so no further live orders can be sent.
    await db.query('UPDATE users SET trading_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['paper', userId]);
    auditLog('live.emergency_stop', req, { userId });
    return res.json({ success: true, killSwitch: true, tradingMode: 'PAPER', cancelled, squared });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET / PUT /api/live/risk ── configurable risk limits ──────────────────────
async function getRisk(req, res) {
  try {
    const limits      = await lts.getRiskLimits();
    const killEngaged = await lts.isKillSwitchEngaged();
    return res.json({ success: true, limits, killSwitch: killEngaged });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function setRisk(req, res) {
  try {
    const limits = await lts.setRiskLimits(req.body || {});
    auditLog('live.risk_limits_updated', req, { userId: uid(req), limits });
    return res.json({ success: true, limits });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/kill-switch ── user-facing kill switch toggle ──────────────
async function setKillSwitch(req, res) {
  // Body speaks in kill-switch terms (engaged = halted); the service speaks in
  // trading terms. The translation happens here, once, and nowhere else.
  const { engaged } = req.body;
  try {
    await lts.setLiveTradingEnabled(!engaged);
    auditLog('live.kill_switch_toggle', req, { userId: uid(req), engaged: !!engaged });
    return res.json({ success: true, killSwitch: !!engaged });
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
    // The OAuth flow stores the token in memory (upstoxAuth), not in
    // broker_accounts — so a DB-only check reports "not connected" even when a
    // valid live session exists. Treat an authenticated in-memory token as
    // linked too, so mode-gating and the "connected" banners are accurate.
    const brokerLinked = !!rows[0]?.is_active || upstoxAuth.isAuthenticated();
    return res.json({
      success: true,
      brokerLinked,
      broker:              rows[0]?.provider || (upstoxAuth.isAuthenticated() ? 'upstox' : null),
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

  // DANGER, historically: this endpoint and POST /api/live/kill-switch share a
  // name but took OPPOSITE booleans — `{engaged:true}` halted trading there,
  // `{enabled:true}` resumed it here. Two "kill switch" endpoints with inverted
  // semantics is a mistake waiting to be made under pressure.
  //
  // `engaged` is now the preferred key on both, matching the endpoint's name.
  // `enabled` is still honoured so existing callers do not silently flip.
  const body = req.body || {};
  const halted = Object.prototype.hasOwnProperty.call(body, 'engaged')
    ? !!body.engaged
    : !body.enabled;

  await lts.setLiveTradingEnabled(!halted);
  auditLog('live.kill_switch', req, { userId: uid(req), engaged: halted });
  return res.json({ success: true, killSwitch: halted, liveEnabled: !halted });
}

module.exports = {
  placeOrder, getCharges, getPositions, getOrders, getFunds, cancelOrder, getStatus, setMode, killSwitch,
  getBrokerStatus, brokerReconnect, brokerDisconnect, brokerRefresh,
  getFundsNormalized, getHoldings, exitPosition, squareOffAll, cancelAllOrders, emergencyStop,
  getRisk, setRisk, setKillSwitch, getDiagnostics, getExecutionQuality,
  getTargets, setTarget, clearTarget,
};
