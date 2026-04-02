// src/strategies/rsiStrategy.js
// ─────────────────────────────────────────────────────────────────────────────
// RSI (Relative Strength Index) Strategy
//
// MATHEMATICAL BASIS  (Wilder, 1978)
// ────────────────────────────────────
// 1. Δ_t = Close_t - Close_{t-1}
// 2. U_t = max(Δ_t, 0)   (up moves)
//    D_t = max(-Δ_t, 0)  (down moves)
// 3. Seed:   AvgU_N = mean(U_1..N)
//            AvgD_N = mean(D_1..N)
// 4. Wilder smooth: AvgU_t = (AvgU_{t-1} × (N-1) + U_t) / N
//                  AvgD_t = (AvgD_{t-1} × (N-1) + D_t) / N
// 5. RS = AvgU / AvgD
// 6. RSI = 100 − 100/(1 + RS)
//
// RSI range: [0, 100]
//   RSI > 70 → overbought (potential SELL)
//   RSI < 30 → oversold   (potential BUY)
//   RSI > 80 → extreme overbought (high-confidence SELL)
//   RSI < 20 → extreme oversold   (high-confidence BUY)
//
// CONFIDENCE CALCULATION
// ──────────────────────
// confidence = distance from neutral (50) normalised to [0,1]
//   For BUY:  conf = (50 - RSI) / 30    e.g. RSI=20 → conf=1.0
//   For SELL: conf = (RSI - 50) / 30    e.g. RSI=80 → conf=1.0
//
// DIVERGENCE DETECTION (bonus signal enhancement)
// ────────────────────────────────────────────────
// Bullish divergence: price makes lower low but RSI makes higher low → stronger BUY
// Bearish divergence: price makes higher high but RSI makes lower high → stronger SELL
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu = require('../utils/mathUtils');
const C  = require('../config/constants');
const logger = require('../config/logger');

const P = C.STRATEGIES.RSI;

/**
 * Compute RSI signal.
 *
 * @param {number[]} prices  - Close prices, ascending. Min: P.PERIOD + 1
 * @returns {{
 *   signal:     'BUY' | 'SELL' | 'HOLD',
 *   confidence: number,
 *   rsiValue:   number | null,
 *   zone:       'EXTREME_OVERSOLD' | 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT' | 'EXTREME_OVERBOUGHT',
 *   divergence: 'BULLISH' | 'BEARISH' | 'NONE',
 *   currentPrice: number,
 *   reason:     string,
 * }}
 */
function generateSignal(prices) {
  if (!Array.isArray(prices) || prices.length < P.PERIOD + 2) {
    return {
      signal: 'HOLD', confidence: 0,
      rsiValue: null, zone: 'NEUTRAL', divergence: 'NONE',
      currentPrice: prices?.at(-1) ?? null,
      reason: `Insufficient data (need ${P.PERIOD + 2}, got ${prices?.length ?? 0})`,
    };
  }

  const currentPrice = prices[prices.length - 1];
  const rsiValue     = mu.rsi(prices, P.PERIOD);

  if (rsiValue === null) {
    return {
      signal: 'HOLD', confidence: 0,
      rsiValue: null, zone: 'NEUTRAL', divergence: 'NONE',
      currentPrice, reason: 'RSI computation returned null',
    };
  }

  // ── Zone classification ──────────────────────────────────────────────────
  let zone;
  if      (rsiValue <= P.EXTREME_OS) zone = 'EXTREME_OVERSOLD';
  else if (rsiValue <= P.OVERSOLD)   zone = 'OVERSOLD';
  else if (rsiValue >= P.EXTREME_OB) zone = 'EXTREME_OVERBOUGHT';
  else if (rsiValue >= P.OVERBOUGHT) zone = 'OVERBOUGHT';
  else                                zone = 'NEUTRAL';

  // ── Divergence detection (look-back 5 bars) ──────────────────────────────
  const lookback = Math.min(5, prices.length - P.PERIOD - 1);
  const divergence = detectDivergence(prices, rsiValue, lookback, P.PERIOD);

  // ── Signal determination ─────────────────────────────────────────────────
  let signal, reason;

  if (zone === 'EXTREME_OVERSOLD' || zone === 'OVERSOLD') {
    signal = 'BUY';
    reason = `RSI ${rsiValue.toFixed(2)} in ${zone} zone (threshold: ${P.OVERSOLD})`;
  } else if (zone === 'EXTREME_OVERBOUGHT' || zone === 'OVERBOUGHT') {
    signal = 'SELL';
    reason = `RSI ${rsiValue.toFixed(2)} in ${zone} zone (threshold: ${P.OVERBOUGHT})`;
  } else {
    signal = 'HOLD';
    reason = `RSI ${rsiValue.toFixed(2)} in neutral zone [${P.OVERSOLD}–${P.OVERBOUGHT}]`;
  }

  // Override HOLD to BUY/SELL if divergence is strong
  if (signal === 'HOLD') {
    if (divergence === 'BULLISH') { signal = 'BUY';  reason += ' + Bullish divergence detected'; }
    if (divergence === 'BEARISH') { signal = 'SELL'; reason += ' + Bearish divergence detected'; }
  }

  // ── Confidence computation ────────────────────────────────────────────────
  let confidence = 0;
  if (signal === 'BUY') {
    confidence = mu.clamp((50 - rsiValue) / 30, 0, 1);
  } else if (signal === 'SELL') {
    confidence = mu.clamp((rsiValue - 50) / 30, 0, 1);
  }

  // Divergence boosts confidence
  if (divergence !== 'NONE') {
    confidence = mu.clamp(confidence + 0.15, 0, 1);
  }

  logger.debug(`[RSI] ${signal} | RSI=${rsiValue.toFixed(2)} | zone=${zone} | div=${divergence} | conf=${confidence.toFixed(3)}`);

  return {
    signal,
    confidence: parseFloat(confidence.toFixed(4)),
    rsiValue:   parseFloat(rsiValue.toFixed(4)),
    zone,
    divergence,
    currentPrice,
    reason,
  };
}

/**
 * Detects price–RSI divergence over the last `lookback` bars.
 *
 * Bullish divergence: price[last] < price[prev low] AND rsi[last] > rsi[prev low]
 * Bearish divergence: price[last] > price[prev high] AND rsi[last] < rsi[prev high]
 */
function detectDivergence(prices, currentRsi, lookback, period) {
  if (lookback < 2) return 'NONE';

  // Compute RSI for each prior bar in the lookback window
  const priceSlice = prices.slice(-(period + lookback + 2));
  const rsiHistory = [];
  for (let i = lookback; i >= 1; i--) {
    const subset = priceSlice.slice(0, priceSlice.length - i);
    const r = mu.rsi(subset, period);
    rsiHistory.push({ price: priceSlice[priceSlice.length - i - 1], rsi: r });
  }

  if (rsiHistory.length === 0) return 'NONE';

  const prevMinPrice = Math.min(...rsiHistory.map(h => h.price));
  const prevMaxPrice = Math.max(...rsiHistory.map(h => h.price));
  const prevMinRsi   = Math.min(...rsiHistory.map(h => h.rsi).filter(r => r !== null));
  const prevMaxRsi   = Math.max(...rsiHistory.map(h => h.rsi).filter(r => r !== null));

  const currentPrice = prices[prices.length - 1];

  if (currentPrice < prevMinPrice && currentRsi > prevMinRsi) return 'BULLISH';
  if (currentPrice > prevMaxPrice && currentRsi < prevMaxRsi) return 'BEARISH';
  return 'NONE';
}

function describe() {
  return {
    name: 'RSI Strategy (Wilder)',
    parameters: P,
    description: 'Generates BUY when RSI < 30 (oversold), SELL when RSI > 70 (overbought). Includes divergence detection.',
    assumedMarketRegime: 'Range-bound or counter-trend',
    limitations: ['RSI can remain in extreme zones during strong trends', 'Period-sensitive'],
  };
}

module.exports = { generateSignal, describe };
