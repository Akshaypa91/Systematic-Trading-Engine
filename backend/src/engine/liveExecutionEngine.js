// src/engine/liveExecutionEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// The live OMS loop. runOnce() is a single guarded tick that keeps our record
// of live orders in sync with the broker's truth (reconciliation) and — in
// later increments — will drive exits and signal→order entries. Order PLACEMENT
// always goes through liveTradingService.placeOrder (the tested safety gauntlet:
// confirmation, kill switch, market hours, qty/value/exposure/daily-loss limits).
//
// SAFETY — this is the autonomous path, so it is caged:
//   • LIVE_EXECUTION_ENABLED (default OFF) — master switch. While off, runOnce
//     is a no-op and nothing here can touch a real order.
//   • Kill switch must be released, market must be open, broker authenticated.
//   • Reconciliation is READ + status-sync only; it never places/cancels orders.
// Reconciliation is the foundation the rest of the loop builds on. It is pure
// enough to unit-test with stubbed db + broker.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const db        = require('../config/database');
const broker    = require('../services/brokerAdapter');
const lts       = require('../services/liveTradingService');
const lifecycle = require('./orderLifecycle');
const { evaluateExit } = require('./positionExit');
const positionTargets  = require('../risk/positionTargets');
const upstoxAuth = require('../services/upstoxAuth');
const logger    = require('../config/logger');

const ENABLED = process.env.LIVE_EXECUTION_ENABLED === 'true';

// Market hours (IST 09:15–15:30, Mon–Fri) — kept local so the engine has no
// hidden coupling to the trade service's copy.
function _isMarketOpen(now = new Date()) {
  const ist  = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day  = ist.getUTCDay();
  const hhmm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && hhmm >= 915 && hhmm <= 1530;
}

/**
 * Reconcile our non-terminal DB orders against the broker order book. Applies
 * only LEGAL state transitions (via orderLifecycle) and persists status +
 * fill fields. Read-only w.r.t. the broker — never places or cancels.
 * @returns {{checked, transitions, illegal, error?}}
 */
async function reconcile(userId) {
  let rows = [];
  try {
    [rows] = await db.query(
      `SELECT id, broker_order_id, status FROM live_orders
       WHERE user_id = ? AND broker_order_id IS NOT NULL
         AND status NOT IN ('COMPLETED','REJECTED','CANCELLED')
       ORDER BY created_at DESC LIMIT 200`,
      [userId]
    );
  } catch (e) {
    return { checked: 0, transitions: 0, illegal: 0, error: `db: ${e.message}` };
  }
  if (!rows.length) return { checked: 0, transitions: 0, illegal: 0 };

  let book = [];
  try { book = await broker.getOrderBook(userId); }
  catch (e) { return { checked: rows.length, transitions: 0, illegal: 0, error: `broker: ${e.message}` }; }
  const byId = new Map((book || []).map(o => [o.order_id, o]));

  let transitions = 0, illegal = 0;
  for (const r of rows) {
    const b = byId.get(r.broker_order_id);
    if (!b) continue;                                  // not in book yet
    const res = lifecycle.transition(r.status, b.status);
    if (res.illegal) {
      illegal++;
      logger.warn(`[LiveExec] illegal transition ${lifecycle.normalize(r.status)}→${lifecycle.normalize(b.status)} on order#${r.id} — ignored`);
      continue;
    }
    if (!res.changed) continue;
    try {
      await db.query(
        `UPDATE live_orders SET status = ?, filled_qty = ?, avg_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [res.state, b.filled_quantity ?? null, b.average_price ?? null, r.id]
      );
      transitions++;
      logger.info(`[LiveExec] order#${r.id} ${lifecycle.normalize(r.status)}→${res.state}`);
    } catch (e) {
      logger.debug(`[LiveExec] persist order#${r.id}: ${e.message}`);
    }
  }
  return { checked: rows.length, transitions, illegal };
}

/**
 * Monitor open live positions against their stored exit intents (SL/TP/trailing)
 * and fire a real market exit on breach. Exits go through lts.exitPosition,
 * which routes to the broker's exit path. A target with no matching open
 * position is deactivated (position already closed elsewhere).
 * @returns {{checked, exits, deactivated, errors}}
 */
async function manageExits(userId) {
  const targets = await positionTargets.getActiveTargets(userId);
  if (!targets.length) return { checked: 0, exits: 0, deactivated: 0, errors: 0 };

  let positions = [];
  try { positions = await lts.getPositions(userId); }
  catch (e) { return { checked: targets.length, exits: 0, deactivated: 0, errors: 1, error: `positions: ${e.message}` }; }
  const bySym = new Map((positions || []).map(p => [String(p.symbol).toUpperCase(), p]));

  let exits = 0, deactivated = 0, errors = 0;
  for (const t of targets) {
    const pos = bySym.get(String(t.symbol).toUpperCase());
    // No live position (qty 0 / closed) → retire the target.
    if (!pos || !(Math.abs(Number(pos.qty)) > 0)) {
      await positionTargets.deactivate(userId, t.symbol); deactivated++;
      continue;
    }
    const price = Number(pos.ltp) || Number(pos.avgPrice);
    const res = evaluateExit({ ...t, price });
    // Persist an advanced trailing high/low-water mark even when not exiting.
    if (t.trailingPct && res.newTrailRef && res.newTrailRef !== t.trailRef) {
      await positionTargets.updateTrailRef(userId, t.symbol, res.newTrailRef);
    }
    if (!res.shouldExit) continue;
    try {
      logger.info(`[LiveExec] EXIT ${t.symbol} via ${res.reason} @₹${price}`);
      await lts.exitPosition(userId, t.symbol);
      await positionTargets.deactivate(userId, t.symbol);
      exits++;
    } catch (e) {
      errors++;
      logger.error(`[LiveExec] exit ${t.symbol} failed: ${e.message}`);
    }
  }
  return { checked: targets.length, exits, deactivated, errors };
}

/**
 * One guarded tick of the live OMS loop. Returns a structured status so the
 * scheduler/diagnostics can see exactly why it did or didn't act.
 */
async function runOnce(userId) {
  if (!ENABLED)            return { ran: false, reason: 'disabled' };
  if (!userId)            return { ran: false, reason: 'no-user' };
  if (!upstoxAuth.isAuthenticated?.()) return { ran: false, reason: 'broker-unauthenticated' };
  if (await lts.isKillSwitchEngaged()) return { ran: false, reason: 'kill-switch' };
  if (!_isMarketOpen())    return { ran: false, reason: 'market-closed' };

  const reconcileRes = await reconcile(userId);
  // Slippage on freshly-filled orders (best-effort; safe if columns missing).
  try { await lts.reconcileFills(userId); } catch (_) {}
  // Exit management: fire SL/TP/trailing exits on breached positions.
  let exitsRes = { checked: 0, exits: 0, deactivated: 0, errors: 0 };
  try { exitsRes = await manageExits(userId); }
  catch (e) { logger.error(`[LiveExec] manageExits: ${e.message}`); exitsRes.errors++; }
  // NEXT INCREMENT (still gated by ENABLED): signal→order entries(userId).
  return { ran: true, reconcile: reconcileRes, exits: exitsRes };
}

function getStatus() {
  return { enabled: ENABLED, marketOpen: _isMarketOpen() };
}

module.exports = { reconcile, manageExits, runOnce, getStatus, _isMarketOpen, ENABLED };
