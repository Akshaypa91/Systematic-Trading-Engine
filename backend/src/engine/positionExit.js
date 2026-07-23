// src/engine/positionExit.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure exit-rule evaluation for an open position against a live price. Given a
// stop-loss, take-profit and/or trailing-stop intent, decide whether to exit
// and why. Handles both long (BUY) and short (SELL) positions. The trailing
// stop tracks a high-water reference (for longs, the highest price seen since
// entry; for shorts, the lowest) and exits when price retraces trailingPct from
// it — the function returns the updated reference so the caller can persist it.
//
// Pure: no DB, no network, no I/O — fully unit-tested.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/**
 * @param {object} t
 *   @param {string} t.side          'BUY' (long) | 'SELL' (short)
 *   @param {number} [t.stopLoss]    absolute price
 *   @param {number} [t.takeProfit]  absolute price
 *   @param {number} [t.trailingPct] e.g. 0.02 = 2% trail
 *   @param {number} [t.trailRef]    current high-water (long) / low-water (short) ref
 *   @param {number} t.price         current price
 * @returns {{ shouldExit:boolean, reason:string|null, newTrailRef:number|null }}
 */
function evaluateExit(t) {
  const price = _num(t.price);
  if (!(price > 0)) return { shouldExit: false, reason: null, newTrailRef: t.trailRef ?? null };

  const isLong = String(t.side || 'BUY').toUpperCase() !== 'SELL';
  const sl = _num(t.stopLoss);
  const tp = _num(t.takeProfit);
  const trailPct = _num(t.trailingPct);

  // Update trailing reference first (high-water for long, low-water for short).
  let ref = _num(t.trailRef);
  if (!(ref > 0)) ref = price;
  const newTrailRef = isLong ? Math.max(ref, price) : Math.min(ref, price);

  if (isLong) {
    if (tp > 0 && price >= tp) return { shouldExit: true, reason: 'TAKE_PROFIT', newTrailRef };
    if (sl > 0 && price <= sl) return { shouldExit: true, reason: 'STOP_LOSS',   newTrailRef };
    if (trailPct > 0 && price <= newTrailRef * (1 - trailPct))
      return { shouldExit: true, reason: 'TRAILING_STOP', newTrailRef };
  } else {
    if (tp > 0 && price <= tp) return { shouldExit: true, reason: 'TAKE_PROFIT', newTrailRef };
    if (sl > 0 && price >= sl) return { shouldExit: true, reason: 'STOP_LOSS',   newTrailRef };
    if (trailPct > 0 && price >= newTrailRef * (1 + trailPct))
      return { shouldExit: true, reason: 'TRAILING_STOP', newTrailRef };
  }
  return { shouldExit: false, reason: null, newTrailRef };
}

module.exports = { evaluateExit };
