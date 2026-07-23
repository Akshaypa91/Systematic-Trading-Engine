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
const { computeQty }   = require('../risk/positionSizing');
const positionTargets  = require('../risk/positionTargets');
const upstoxAuth = require('../services/upstoxAuth');
const logger    = require('../config/logger');

const ENABLED = process.env.LIVE_EXECUTION_ENABLED === 'true';
// Autonomous ENTRIES are the riskiest path (they OPEN real positions), so they
// require a SECOND explicit flag on top of the master switch. Reconcile + exits
// can run with just LIVE_EXECUTION_ENABLED; entries need both.
const ENTRIES_ENABLED = ENABLED && process.env.LIVE_AUTO_ENTRIES_ENABLED === 'true';

// Entry sizing / bracket config (conservative defaults).
const AUTO_QTY     = parseInt(process.env.LIVE_AUTO_QTY || '1', 10);
const AUTO_SL_PCT  = parseFloat(process.env.LIVE_AUTO_SL_PCT || '0.02');   // 2%
const AUTO_TP_PCT  = parseFloat(process.env.LIVE_AUTO_TP_PCT || '0.04');   // 4%
const MIN_CONF     = parseFloat(process.env.LIVE_AUTO_MIN_CONFIDENCE || '0.6');
const MAX_NEW_PER_TICK = parseInt(process.env.LIVE_AUTO_MAX_NEW_PER_TICK || '1', 10);
// Portfolio-level sizing + concurrency.
const SIZING_METHOD    = (process.env.LIVE_SIZING_METHOD || 'fixed').toLowerCase(); // fixed|risk|voltarget
const RISK_PER_TRADE   = parseFloat(process.env.LIVE_RISK_PER_TRADE || '0.01');     // 1% of capital
const TARGET_VOL       = parseFloat(process.env.LIVE_TARGET_VOL || '0.02');
const SIZING_CAPITAL_FB = parseFloat(process.env.LIVE_SIZING_CAPITAL || '0');       // fallback if funds unavailable
const MAX_CONCURRENT   = parseInt(process.env.LIVE_MAX_CONCURRENT_POSITIONS || '5', 10);

// Dead-man's switch: after this many consecutive failed ticks, halt (engage the
// kill switch) so a degraded engine can't keep trading blind.
const DEADMAN_MAX_ERRORS = parseInt(process.env.LIVE_DEADMAN_MAX_ERRORS || '3', 10);
let _consecutiveErrors = 0;
let _lastHeartbeat = null;
let _lastResult = null;

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

// ── Safety: daily-loss auto-halt ──────────────────────────────────────────────
// If today's realised+unrealised P&L breaches the configured daily-loss limit,
// engage the kill switch so NOTHING else trades until a human releases it. This
// is proactive — placeOrder also rejects on the limit, but the halt stops the
// whole engine (exits still allowed to run through manageExits are fine; entries
// are blocked because the kill switch is now engaged).
async function _enforceDailyLossHalt(userId) {
  try {
    const limits = await lts.getRiskLimits();
    if (!(limits.dailyLossLimit > 0)) return { halted: false };
    const positions = await lts.getPositions(userId);
    const pnl = (positions || []).reduce((a, p) => a + (Number(p.overallPnl) || 0), 0);
    if (pnl < 0 && Math.abs(pnl) >= limits.dailyLossLimit) {
      await lts.setKillSwitch(false);   // false = live trading DISABLED (kill engaged)
      logger.error(`[LiveExec] DAILY-LOSS HALT: P&L ₹${pnl} ≥ limit ₹${limits.dailyLossLimit} — kill switch engaged`);
      return { halted: true, pnl };
    }
    return { halted: false, pnl };
  } catch (e) {
    logger.warn(`[LiveExec] daily-loss check unavailable: ${e.message}`);
    return { halted: false, error: e.message };
  }
}

// Recent BUY signals from the signals table (default entry source).
async function _recentSignals(minutes = 10) {
  try {
    const [rows] = await db.query(
      `SELECT symbol, signal_type AS signal, confidence, price_at_signal AS price
       FROM signals
       WHERE signal_type = 'BUY' AND signal_ts >= (NOW() - INTERVAL ? MINUTE)
       ORDER BY signal_ts DESC LIMIT 20`,
      [minutes]
    );
    return rows || [];
  } catch (e) { logger.debug(`[LiveExec] recent signals: ${e.message}`); return []; }
}

// ── Autonomous entries (double-gated) ─────────────────────────────────────────
// Turn BUY signals into real orders + a bracket target. Skips symbols that
// already have an open position or an active target, caps new entries per tick,
// and routes every order through lts.placeOrder (full risk gauntlet). `signals`
// is injectable for testing; otherwise pulled from the provided source.
async function manageEntries(userId, { signals } = {}) {
  if (!ENTRIES_ENABLED) return { enabled: false, placed: 0, skipped: 0, errors: 0 };
  const sigs = Array.isArray(signals) ? signals : [];
  if (!sigs.length) return { enabled: true, placed: 0, skipped: 0, errors: 0 };

  // What we already hold / have working, so we don't double-enter.
  let held = new Set();
  try {
    const positions = await lts.getPositions(userId);
    held = new Set((positions || []).filter(p => Math.abs(Number(p.qty)) > 0).map(p => String(p.symbol).toUpperCase()));
  } catch (_) {}
  let targeted = new Set();
  try {
    const t = await positionTargets.getActiveTargets(userId);
    targeted = new Set(t.map(x => String(x.symbol).toUpperCase()));
  } catch (_) {}

  // Portfolio concurrency cap — how many NEW positions we may still open.
  const openCount = new Set([...held, ...targeted]).size;
  let concurrencyBudget = Math.max(0, MAX_CONCURRENT - openCount);

  // Deployable capital for sizing (available cash), with an env fallback.
  let capital = SIZING_CAPITAL_FB;
  if (SIZING_METHOD !== 'fixed') {
    try { const f = await lts.getFundsNormalized(userId); capital = Number(f?.availableCash) || SIZING_CAPITAL_FB; } catch (_) {}
  }
  let maxPositionValue = 0;
  try { const lim = await lts.getRiskLimits(); maxPositionValue = Number(lim?.maxPositionSize) || 0; } catch (_) {}

  let placed = 0, skipped = 0, errors = 0;
  for (const sig of sigs) {
    if (placed >= MAX_NEW_PER_TICK) break;
    const symbol = String(sig.symbol || '').toUpperCase();
    const price  = Number(sig.price || sig.currentPrice);
    if (String(sig.signal).toUpperCase() !== 'BUY') { skipped++; continue; }
    if (!(Number(sig.confidence) >= MIN_CONF))       { skipped++; continue; }
    if (!symbol || !(price > 0))                     { skipped++; continue; }
    if (held.has(symbol) || targeted.has(symbol))    { skipped++; continue; }
    if (concurrencyBudget <= 0)                       { skipped++; continue; }   // portfolio full

    const qty = computeQty({
      method: SIZING_METHOD, price, capital,
      fixedQty: AUTO_QTY, riskPerTrade: RISK_PER_TRADE, stopPct: AUTO_SL_PCT,
      targetVol: TARGET_VOL, assetVol: Number(sig.assetVol || sig.vol) || undefined,
      maxPositionValue,
    });
    if (!(qty > 0)) { skipped++; continue; }          // sizing says no room

    try {
      await lts.placeOrder(userId, {
        symbol, side: 'BUY', qty, orderType: 'MARKET',
        product: 'CNC', validity: 'DAY', confirmed: true, currentPrice: price,
      });
      await positionTargets.upsertTarget(userId, symbol, {
        side: 'BUY',
        stopLoss:   +(price * (1 - AUTO_SL_PCT)).toFixed(2),
        takeProfit: +(price * (1 + AUTO_TP_PCT)).toFixed(2),
      });
      placed++;
      held.add(symbol);
      concurrencyBudget--;
      logger.info(`[LiveExec] AUTO-ENTRY BUY ${qty}×${symbol} @₹${price} (conf ${sig.confidence}, ${SIZING_METHOD})`);
    } catch (e) {
      errors++;
      logger.warn(`[LiveExec] auto-entry ${symbol} rejected: ${e.message}`);
    }
  }
  return { enabled: true, placed, skipped, errors };
}

/**
 * One guarded tick of the live OMS loop. Returns a structured status so the
 * scheduler/diagnostics can see exactly why it did or didn't act.
 */
async function runOnce(userId, opts = {}) {
  if (!ENABLED)            return { ran: false, reason: 'disabled' };
  if (!userId)            return { ran: false, reason: 'no-user' };
  if (!upstoxAuth.isAuthenticated?.()) return { ran: false, reason: 'broker-unauthenticated' };
  if (await lts.isKillSwitchEngaged()) return { ran: false, reason: 'kill-switch' };
  if (!_isMarketOpen())    return { ran: false, reason: 'market-closed' };

  let tickErrors = 0;
  const reconcileRes = await reconcile(userId);
  if (reconcileRes.error) tickErrors++;
  try { await lts.reconcileFills(userId); } catch (_) {}

  // Daily-loss auto-halt BEFORE any new risk. If it halts, exits still ran via
  // reconcile; entries are now blocked by the engaged kill switch.
  const halt = await _enforceDailyLossHalt(userId);

  let exitsRes = { checked: 0, exits: 0, deactivated: 0, errors: 0 };
  try { exitsRes = await manageExits(userId); }
  catch (e) { logger.error(`[LiveExec] manageExits: ${e.message}`); exitsRes.errors++; tickErrors++; }

  let entriesRes = { enabled: ENTRIES_ENABLED, placed: 0, skipped: 0, errors: 0 };
  if (!halt.halted) {
    try {
      // Use injected signals (tests) or pull recent BUY signals when entries are on.
      const entryOpts = opts.signals ? opts : (ENTRIES_ENABLED ? { signals: await _recentSignals() } : {});
      entriesRes = await manageEntries(userId, entryOpts);
    }
    catch (e) { logger.error(`[LiveExec] manageEntries: ${e.message}`); entriesRes.errors++; tickErrors++; }
  }

  // Dead-man's switch: sustained failures → halt so a degraded engine can't
  // keep operating blind.
  if (tickErrors > 0) _consecutiveErrors++; else _consecutiveErrors = 0;
  let deadman = false;
  if (_consecutiveErrors >= DEADMAN_MAX_ERRORS) {
    try { await lts.setKillSwitch(false); deadman = true; _consecutiveErrors = 0;
      logger.error(`[LiveExec] DEAD-MAN SWITCH: ${DEADMAN_MAX_ERRORS} consecutive failed ticks — kill switch engaged`);
    } catch (_) {}
  }

  _lastHeartbeat = new Date().toISOString();
  _lastResult = { ran: true, reconcile: reconcileRes, exits: exitsRes, entries: entriesRes,
    dailyLossHalt: halt.halted, deadman, consecutiveErrors: _consecutiveErrors };
  return _lastResult;
}

function getStatus() {
  return {
    enabled: ENABLED,
    entriesEnabled: ENTRIES_ENABLED,
    marketOpen: _isMarketOpen(),
    consecutiveErrors: _consecutiveErrors,
    lastHeartbeat: _lastHeartbeat,
    lastResult: _lastResult,
  };
}

// Test hook to reset internal counters between cases.
function _resetSafety() { _consecutiveErrors = 0; _lastHeartbeat = null; _lastResult = null; }

module.exports = {
  reconcile, manageExits, manageEntries, runOnce, getStatus,
  _enforceDailyLossHalt, _isMarketOpen, _resetSafety, ENABLED, ENTRIES_ENABLED,
};
