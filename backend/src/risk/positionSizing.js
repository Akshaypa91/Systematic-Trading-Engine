// src/risk/positionSizing.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure position-sizing. Converts a trade idea into a share quantity under one of
// three schemes, then clamps to hard caps (max position value + affordability).
//
//   fixed     — a constant qty (dumbest, safest to start).
//   risk      — risk a fixed % of capital per trade: qty = (capital·riskPct) /
//               (price·stopPct). Ties size to the stop distance so every trade
//               risks the same rupee amount.
//   voltarget — target a per-position volatility: qty = capital·(targetVol/
//               assetVol) / price. Lower-vol names get bigger positions.
//
// Caps applied to every method:
//   • maxPositionValue → qty ≤ floor(maxPositionValue / price)
//   • affordability    → qty ≤ floor(capital·0.95 / price)
// Pure: no DB, no network — fully unit-tested.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * @param {object} o
 *   @param {'fixed'|'risk'|'voltarget'} o.method
 *   @param {number} o.price
 *   @param {number} [o.capital]           deployable capital (₹)
 *   @param {number} [o.fixedQty=1]
 *   @param {number} [o.riskPerTrade=0.01] fraction of capital risked (risk method)
 *   @param {number} [o.stopPct=0.02]      stop distance as fraction of price
 *   @param {number} [o.targetVol]         desired per-position vol (voltarget)
 *   @param {number} [o.assetVol]          the asset's vol, same units as targetVol
 *   @param {number} [o.maxPositionValue]  hard ₹ cap on the position
 * @returns {number} integer qty ≥ 0
 */
function computeQty(o = {}) {
  const method  = String(o.method || 'fixed').toLowerCase();
  const price   = _num(o.price);
  if (!(price > 0)) return 0;

  const capital = _num(o.capital);
  let qty = 0;

  if (method === 'risk') {
    const riskAmt      = capital * _num(o.riskPerTrade || 0.01);
    const perShareRisk = price * _num(o.stopPct || 0.02);
    qty = perShareRisk > 0 ? Math.floor(riskAmt / perShareRisk) : 0;
  } else if (method === 'voltarget') {
    const targetVol = _num(o.targetVol);
    const assetVol  = _num(o.assetVol);
    qty = (capital > 0 && targetVol > 0 && assetVol > 0)
      ? Math.floor((capital * (targetVol / assetVol)) / price)
      : 0;
  } else { // fixed
    qty = Math.max(0, Math.floor(_num(o.fixedQty || 1)));
  }

  // Hard caps.
  const maxVal = _num(o.maxPositionValue);
  if (maxVal > 0) qty = Math.min(qty, Math.floor(maxVal / price));
  if (capital > 0) qty = Math.min(qty, Math.floor((capital * 0.95) / price)); // affordability

  return Math.max(0, qty);
}

module.exports = { computeQty };
