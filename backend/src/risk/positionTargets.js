// src/risk/positionTargets.js
// Persistence for per-position exit intents (stop-loss / take-profit / trailing)
// that the live execution engine monitors. Backed by live_position_targets.
'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

const _n = (v) => (v == null || v === '' ? null : Number(v));

async function getActiveTargets(userId) {
  try {
    const [rows] = await db.query(
      `SELECT user_id, symbol, side, stop_loss, take_profit, trailing_pct, trail_ref
       FROM live_position_targets WHERE user_id = ? AND active = true`,
      [userId]
    );
    return (rows || []).map(r => ({
      userId:      r.user_id,
      symbol:      r.symbol,
      side:        r.side || 'BUY',
      stopLoss:    _n(r.stop_loss),
      takeProfit:  _n(r.take_profit),
      trailingPct: _n(r.trailing_pct),
      trailRef:    _n(r.trail_ref),
    }));
  } catch (e) {
    logger.debug(`[Targets] read failed (run migrate-position-targets.sql?): ${e.message}`);
    return [];
  }
}

async function upsertTarget(userId, symbol, { side = 'BUY', stopLoss, takeProfit, trailingPct } = {}) {
  await db.query(
    `INSERT INTO live_position_targets (user_id, symbol, side, stop_loss, take_profit, trailing_pct, active)
     VALUES (?, ?, ?, ?, ?, ?, true)
     ON DUPLICATE KEY UPDATE side = VALUES(side), stop_loss = VALUES(stop_loss),
       take_profit = VALUES(take_profit), trailing_pct = VALUES(trailing_pct),
       active = true, updated_at = CURRENT_TIMESTAMP`,
    [userId, String(symbol).toUpperCase(), side, _n(stopLoss), _n(takeProfit), _n(trailingPct)]
  );
  return getActiveTargets(userId);
}

async function updateTrailRef(userId, symbol, ref) {
  if (!(Number(ref) > 0)) return;
  try {
    await db.query(
      `UPDATE live_position_targets SET trail_ref = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND symbol = ? AND active = true`,
      [Number(ref), userId, String(symbol).toUpperCase()]
    );
  } catch (e) { logger.debug(`[Targets] trailRef: ${e.message}`); }
}

async function deactivate(userId, symbol) {
  try {
    await db.query(
      `UPDATE live_position_targets SET active = false, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND symbol = ?`,
      [userId, String(symbol).toUpperCase()]
    );
  } catch (e) { logger.debug(`[Targets] deactivate: ${e.message}`); }
}

module.exports = { getActiveTargets, upsertTarget, updateTrailRef, deactivate };
