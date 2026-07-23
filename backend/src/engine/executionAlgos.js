// src/engine/executionAlgos.js
// ─────────────────────────────────────────────────────────────────────────────
// Execution algorithms that reduce market impact on larger orders. Two planners
// (pure) + one sliced executor (thin, with injectable place/sleep so it's fully
// unit-testable without a broker or real timers):
//
//   sliceOrder()          — split a parent qty into ≤ maxChildQty child orders.
//   twapSchedule()        — spread a qty into N equal slices over an interval.
//   limitThenMarketAction — decide WAIT / CONVERT_TO_MARKET / DONE for a resting
//                           limit order based on elapsed time + fill progress.
//   executeSliced()       — place child orders sequentially via a caller-supplied
//                           place function, pausing intervalMs between them.
//
// The slippage tracking (executionQuality) lets you MEASURE whether these help.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const _int = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; };

/**
 * Split a parent quantity into child quantities each ≤ maxChildQty, distributed
 * as evenly as possible (whole shares). maxChildQty ≤ 0 or qty ≤ max → one slice.
 * @returns {number[]}
 */
function sliceOrder(totalQty, maxChildQty) {
  const total = _int(totalQty);
  const max   = _int(maxChildQty);
  if (total <= 0) return [];
  if (max <= 0 || total <= max) return [total];
  const n = Math.ceil(total / max);
  const base = Math.floor(total / n);
  let rem = total - base * n;
  const out = [];
  for (let i = 0; i < n; i++) { out.push(base + (rem > 0 ? 1 : 0)); if (rem > 0) rem--; }
  return out;
}

/**
 * TWAP schedule: N equal (±1) slices at fixed offsets.
 * @returns {{offsetMs:number, qty:number}[]}
 */
function twapSchedule(totalQty, slices, intervalMs) {
  const total = _int(totalQty);
  const n     = Math.max(1, _int(slices));
  const iv    = Math.max(0, Number(intervalMs) || 0);
  if (total <= 0) return [];
  const base = Math.floor(total / n);
  let rem = total - base * n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const qty = base + (rem > 0 ? 1 : 0); if (rem > 0) rem--;
    if (qty > 0) out.push({ offsetMs: i * iv, qty });
  }
  return out;
}

/**
 * Resting-limit lifecycle decision.
 * @returns {'DONE'|'CONVERT_TO_MARKET'|'WAIT'}
 */
function limitThenMarketAction({ elapsedMs, timeoutMs, filledQty, totalQty }) {
  if (_int(filledQty) >= _int(totalQty) && _int(totalQty) > 0) return 'DONE';
  if (Number(elapsedMs) >= Number(timeoutMs)) return 'CONVERT_TO_MARKET';
  return 'WAIT';
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Place a parent order as sequential child slices.
 * @param {(childOrder:object)=>Promise} placeFn  places one child order
 * @param {object} order   { symbol, side, qty, ...rest passed through }
 * @param {object} opts    { maxChildQty, intervalMs, sleep }
 * @returns {Promise<{children:number, placed:number, errors:number, slices:number[]}>}
 */
async function executeSliced(placeFn, order, opts = {}) {
  const slices = sliceOrder(order.qty, opts.maxChildQty);
  const sleep  = opts.sleep || _sleep;
  const iv     = Math.max(0, Number(opts.intervalMs) || 0);
  let placed = 0, errors = 0;
  for (let i = 0; i < slices.length; i++) {
    try { await placeFn({ ...order, qty: slices[i] }); placed++; }
    catch (_) { errors++; }
    if (iv > 0 && i < slices.length - 1) await sleep(iv);
  }
  return { children: slices.length, placed, errors, slices };
}

module.exports = { sliceOrder, twapSchedule, limitThenMarketAction, executeSliced };
