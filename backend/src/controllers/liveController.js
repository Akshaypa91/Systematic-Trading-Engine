// src/controllers/liveController.js
'use strict';

const lts      = require('../services/liveTradingService');
const db       = require('../config/database');
const logger   = require('../config/logger');
const auditLog = require('../middleware/auditLog');

function uid(req) { return req.user?.userId ?? req.user?.id ?? null; }

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

module.exports = { placeOrder, getPositions, getOrders, getFunds, cancelOrder, getStatus, setMode, killSwitch };
