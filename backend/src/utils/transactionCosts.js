// src/utils/transactionCosts.js
// ─────────────────────────────────────────────────────────────────────────────
// IMPROVEMENT 1: Realistic Transaction Cost Modeling
//
// PROBLEM IT SOLVES
// ──────────────────
// Naive backtests use a single flat commission rate (e.g., 0.03%) and ignore:
//   • STT (Securities Transaction Tax) — mandatory 0.1% on sell side
//   • Stamp duty — 0.015% on buy side
//   • Exchange charges, SEBI fees, GST
//   • Depository charges (DP) per sell
//
// On a ₹1 lakh delivery trade, simplified cost = ₹30 (0.03%).
// Actual NSE delivery cost = ₹30 + ₹100 STT + ₹15 stamp + ₹7 exchange + DP...
// Total real cost ≈ ₹165 = 0.165% — 5.5× higher than naive estimate!
//
// WHY IT MATTERS
// ──────────────
// A strategy that looks profitable with 0.03% costs can become a loser at
// realistic 0.15%+ costs. This is a major source of backtest-to-live divergence.
//
// IMPROVEMENT 2: Slippage Simulation
//
// PROBLEM IT SOLVES
// ──────────────────
// Using bar.close as fill price is unrealistic because:
//   1. You can't trade at exactly the last price
//   2. Bid-ask spread means you pay MORE when buying, get LESS when selling
//   3. Market impact: large orders push the price against you
//   4. Timing: signal fires at close, order executes next open or intraday
//
// MODEL
// ──────
// effectiveSlippage = BASE + SPREAD/2 + volScaling × realisedVol
// Buy fill  = marketPrice × (1 + effectiveSlippage)
// Sell fill = marketPrice × (1 − effectiveSlippage)
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const C      = require('../config/constants');
const logger = require('../config/logger');

const TC = C.TRANSACTION_COSTS;
const SL = C.SLIPPAGE;

// ── Transaction Cost Calculator ───────────────────────────────────────────────

/**
 * Compute full NSE delivery transaction costs for one side of a trade.
 *
 * Returns itemised breakdown + total cost in ₹ and as a fraction of trade value.
 *
 * @param {{ side: 'BUY'|'SELL', price: number, quantity: number }} params
 * @returns {{
 *   brokerage:      number,  // ₹
 *   stt:            number,  // ₹
 *   exchangeCharge: number,  // ₹
 *   sebiFee:        number,  // ₹
 *   gst:            number,  // ₹
 *   stampDuty:      number,  // ₹
 *   dpCharge:       number,  // ₹ (only on SELL)
 *   totalCost:      number,  // ₹
 *   totalPct:       number,  // fraction of trade value
 *   tradeValue:     number,  // ₹
 * }}
 */
function computeCosts({ side, price, quantity }) {
  if (!price || price <= 0 || !quantity || quantity < 1)
    throw new RangeError('[TransactionCosts] price and quantity must be positive');
  if (side !== 'BUY' && side !== 'SELL')
    throw new TypeError('[TransactionCosts] side must be BUY or SELL');

  // Use simplified single-rate model if configured (for speed in backtests)
  if (TC.USE_SIMPLIFIED) {
    const tradeValue = price * quantity;
    const commission = Math.min(tradeValue * TC.BROKERAGE_PCT, TC.BROKERAGE_FLAT * 2);
    return {
      brokerage: parseFloat(commission.toFixed(4)),
      stt: 0, exchangeCharge: 0, sebiFee: 0,
      gst: 0, stampDuty: 0, dpCharge: 0,
      totalCost:  parseFloat(commission.toFixed(4)),
      totalPct:   parseFloat((commission / tradeValue).toFixed(8)),
      tradeValue: parseFloat(tradeValue.toFixed(2)),
    };
  }

  const tradeValue = price * quantity;

  // 1. Brokerage: min(percentage, flat ₹20)
  const brokerageRaw = tradeValue * TC.BROKERAGE_PCT;
  const brokerage    = Math.min(brokerageRaw, TC.BROKERAGE_FLAT);

  // 2. STT: 0.1% on SELL (mandatory), 0% on BUY for delivery
  const stt = tradeValue * (side === 'SELL' ? TC.STT_SELL_PCT : TC.STT_BUY_PCT);

  // 3. Exchange transaction charge (both sides)
  const exchangeCharge = tradeValue * TC.EXCHANGE_CHARGE_PCT;

  // 4. SEBI turnover fee (both sides)
  const sebiFee = tradeValue * TC.SEBI_FEE_PCT;

  // 5. GST: 18% on (brokerage + exchange charges)
  const gst = (brokerage + exchangeCharge) * TC.GST_RATE;

  // 6. Stamp duty: 0.015% on BUY only
  const stampDuty = side === 'BUY' ? tradeValue * TC.STAMP_DUTY_PCT : 0;

  // 7. DP charge: ₹13.5 per scrip per sell day (flat, paid to CDSL/NSDL)
  const dpCharge = side === 'SELL' ? TC.DP_CHARGE_FLAT : 0;

  const totalCost = brokerage + stt + exchangeCharge + sebiFee + gst + stampDuty + dpCharge;

  logger.debug(
    `[TxCost] ${side} ${quantity}@₹${price.toFixed(2)} | ` +
    `broker=₹${brokerage.toFixed(2)} stt=₹${stt.toFixed(2)} ` +
    `stamp=₹${stampDuty.toFixed(2)} dp=₹${dpCharge.toFixed(2)} ` +
    `total=₹${totalCost.toFixed(2)} (${(totalCost / tradeValue * 100).toFixed(4)}%)`
  );

  return {
    brokerage:      parseFloat(brokerage.toFixed(4)),
    stt:            parseFloat(stt.toFixed(4)),
    exchangeCharge: parseFloat(exchangeCharge.toFixed(4)),
    sebiFee:        parseFloat(sebiFee.toFixed(6)),
    gst:            parseFloat(gst.toFixed(4)),
    stampDuty:      parseFloat(stampDuty.toFixed(4)),
    dpCharge:       parseFloat(dpCharge.toFixed(2)),
    totalCost:      parseFloat(totalCost.toFixed(4)),
    totalPct:       parseFloat((totalCost / tradeValue).toFixed(8)),
    tradeValue:     parseFloat(tradeValue.toFixed(2)),
  };
}

/**
 * Convenience: compute ROUND-TRIP cost (entry BUY + exit SELL).
 * Returns total ₹ cost and effective pct of entry trade value.
 */
function roundTripCost({ entryPrice, exitPrice, quantity }) {
  const buy  = computeCosts({ side: 'BUY',  price: entryPrice, quantity });
  const sell = computeCosts({ side: 'SELL', price: exitPrice,  quantity });
  const total = buy.totalCost + sell.totalCost;
  return {
    entryCost:  buy.totalCost,
    exitCost:   sell.totalCost,
    totalCost:  parseFloat(total.toFixed(4)),
    totalPct:   parseFloat((total / buy.tradeValue).toFixed(8)),
    breakdown:  { buy, sell },
  };
}

// ── Slippage Model ────────────────────────────────────────────────────────────

/**
 * Compute effective slippage as a fraction of price.
 *
 * Components:
 *   BASE_PCT    — timing latency (signal → execution)
 *   SPREAD_PCT  — half the bid-ask spread (you always pay the worse side)
 *   vol-scaling — when volatility is high, spreads widen
 *
 * @param {{ side: 'BUY'|'SELL', realisedVol?: number }} params
 *   realisedVol: annualised vol (e.g., 0.20 for 20%). Used for vol-scaling.
 * @returns {number} slippage as a fraction (e.g., 0.0008 = 0.08%)
 */
function computeSlippage({ side, realisedVol = null }) {
  let slip = SL.BASE_PCT + SL.SPREAD_PCT;

  // Scale slippage by realised volatility
  // Low-vol environment: spreads tighter; high-vol: spreads wider
  if (SL.VOL_SCALING && realisedVol != null && isFinite(realisedVol)) {
    // Normal daily vol for NIFTY50 ≈ 1% (0.01). Annual ≈ 16% (0.16).
    // We add proportional slippage: if vol is 2× normal, slippage 1.5×
    const baseAnnualVol = 0.16;
    const volRatio = Math.max(0.5, Math.min(realisedVol / baseAnnualVol, 3.0));
    slip *= (1 + (volRatio - 1) * 0.3); // moderate scaling
  }

  // Hard cap
  slip = Math.min(slip, SL.MAX_PCT);

  return parseFloat(slip.toFixed(8));
}

/**
 * Apply slippage to get realistic fill price.
 *
 * BUY:  fillPrice = marketPrice × (1 + slippage)   [you pay MORE]
 * SELL: fillPrice = marketPrice × (1 − slippage)   [you receive LESS]
 *
 * @param {{ side: 'BUY'|'SELL', marketPrice: number, realisedVol?: number }} params
 * @returns {{ fillPrice: number, slippagePct: number, slippageCost: number }}
 */
function applySlippage({ side, marketPrice, realisedVol = null }) {
  if (!marketPrice || marketPrice <= 0)
    throw new RangeError('[Slippage] marketPrice must be positive');

  const slip = computeSlippage({ side, realisedVol });
  const direction = side === 'BUY' ? 1 : -1;
  const fillPrice = marketPrice * (1 + direction * slip);

  return {
    fillPrice:    parseFloat(fillPrice.toFixed(4)),
    slippagePct:  parseFloat(slip.toFixed(8)),
    slippageCost: parseFloat(Math.abs(fillPrice - marketPrice).toFixed(4)),
  };
}

/**
 * Compute total execution cost (slippage + transaction costs) for a trade.
 * This is the single function to call from the backtester.
 *
 * @returns {{
 *   fillPrice:     number,
 *   slippagePct:   number,
 *   txCost:        number,  // ₹
 *   txCostPct:     number,  // fraction
 *   totalCostPct:  number,  // slippage + tx as fraction of trade value
 *   details:       Object,
 * }}
 */
function computeExecutionCost({ side, marketPrice, quantity, realisedVol = null }) {
  const slippageResult = applySlippage({ side, marketPrice, realisedVol });
  const txResult       = computeCosts({ side, price: slippageResult.fillPrice, quantity });

  const totalCostPct = slippageResult.slippagePct + txResult.totalPct;

  return {
    fillPrice:    slippageResult.fillPrice,
    slippagePct:  slippageResult.slippagePct,
    txCost:       txResult.totalCost,
    txCostPct:    txResult.totalPct,
    totalCostPct: parseFloat(totalCostPct.toFixed(8)),
    details:      { slippage: slippageResult, transaction: txResult },
  };
}

module.exports = {
  computeCosts,
  roundTripCost,
  computeSlippage,
  applySlippage,
  computeExecutionCost,
};
