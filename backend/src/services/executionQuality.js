// src/services/executionQuality.js
// ─────────────────────────────────────────────────────────────────────────────
// Execution-quality / slippage analytics. Every live order records an EXPECTED
// price (the LTP/limit at submit time) and, once filled, an ACTUAL average fill
// price from the broker. The gap is slippage — the hidden cost that makes live
// results diverge from backtests. Measuring it lets us (a) monitor execution
// health and (b) feed a realistic slippage assumption back into the backtester.
//
// Convention (cost view, in basis points of the expected price):
//   BUY : adverse when fill > expected   → slippageBps = (fill-expected)/expected*1e4
//   SELL: adverse when fill < expected   → slippageBps = (expected-fill)/expected*1e4
//   positive bps = you paid more / received less than expected (bad);
//   negative bps = price improvement (good).
// This module is pure — no DB, no network — so it is fully unit-tested.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/**
 * Slippage for a single fill.
 * @returns {{ slippageAbs:number, slippageBps:number, favorable:boolean }|null}
 *          null if inputs are unusable (missing prices).
 */
function computeSlippage({ side, expectedPrice, fillPrice }) {
  const exp = _num(expectedPrice);
  const fil = _num(fillPrice);
  if (!(exp > 0) || !(fil > 0)) return null;
  const isBuy = String(side || 'BUY').toUpperCase() !== 'SELL';
  // Signed adverse move in price terms.
  const adverse = isBuy ? (fil - exp) : (exp - fil);
  const slippageBps = +((adverse / exp) * 10000).toFixed(2);
  return {
    slippageAbs: +adverse.toFixed(4),   // ₹ per share, positive = adverse
    slippageBps,
    favorable: slippageBps < 0,
  };
}

// Median helper.
function _median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Aggregate execution quality across filled orders.
 * @param {Array<{symbol,side,expectedPrice,fillPrice,qty}>} orders
 */
function aggregate(orders) {
  const rows = [];
  for (const o of (orders || [])) {
    const s = computeSlippage(o);
    if (s) rows.push({ symbol: o.symbol, qty: _num(o.qty) || 0, ...s });
  }
  if (rows.length === 0) {
    return { count: 0, avgSlippageBps: 0, medianSlippageBps: 0, worstSlippageBps: 0,
             favorableRate: 0, totalSlippageCost: 0, bySymbol: {} };
  }
  const bpsList = rows.map(r => r.slippageBps);
  const bySymbol = {};
  for (const r of rows) {
    const b = (bySymbol[r.symbol] ||= { count: 0, sumBps: 0 });
    b.count++; b.sumBps += r.slippageBps;
  }
  for (const k of Object.keys(bySymbol)) {
    bySymbol[k].avgBps = +(bySymbol[k].sumBps / bySymbol[k].count).toFixed(2);
    delete bySymbol[k].sumBps;
  }
  const favorable = rows.filter(r => r.favorable).length;
  // ₹ cost = per-share adverse × qty, summed (adverse positive = cost).
  const totalSlippageCost = +rows.reduce((a, r) => a + r.slippageAbs * (r.qty || 0), 0).toFixed(2);
  return {
    count: rows.length,
    avgSlippageBps:    +(bpsList.reduce((a, b) => a + b, 0) / rows.length).toFixed(2),
    medianSlippageBps: +_median(bpsList).toFixed(2),
    worstSlippageBps:  +Math.max(...bpsList).toFixed(2),
    favorableRate:     +(favorable / rows.length).toFixed(3),
    totalSlippageCost,
    bySymbol,
  };
}

/**
 * A slippage fraction (e.g. 0.0007 = 7 bps) to feed the backtester's slippagePct
 * so simulations reflect YOUR measured execution, not a guess. Uses the average
 * ADVERSE slippage (favorable fills floored at 0 so we never model negative cost),
 * clamped to a sane band.
 * @param {object} summary  result of aggregate()
 * @param {number} floorPct default 0.0005 (5 bps) when no data
 */
function estimateBacktestSlippagePct(summary, floorPct = 0.0005) {
  if (!summary || !summary.count) return floorPct;
  const adverseBps = Math.max(0, summary.avgSlippageBps);
  const pct = adverseBps / 10000;
  // Clamp to [1bp, 100bp] to avoid pathological single-fill outliers.
  return Math.min(0.01, Math.max(0.0001, pct || floorPct));
}

module.exports = { computeSlippage, aggregate, estimateBacktestSlippagePct };
