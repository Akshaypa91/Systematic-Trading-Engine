// src/strategies/meanReversion.js
// ─────────────────────────────────────────────────────────────────────────────
// Mean Reversion Strategy (Z-score based)
//
// MATHEMATICAL BASIS
// ──────────────────
// A mean-reverting process (Ornstein–Uhlenbeck model) assumes prices oscillate
// around a long-run equilibrium μ. When a price deviates significantly (measured
// by Z-score), there is a statistical tendency to revert.
//
//   Z = (P_t - μ_N) / σ_N
//
// where μ_N = rolling mean over N days, σ_N = rolling std-dev over N days.
//
//   Z < -2  → price is 2 std-devs BELOW mean → BUY (expect reversion upward)
//   Z > +2  → price is 2 std-devs ABOVE mean → SELL (expect reversion downward)
//   |Z| < 0.5 → price near mean → EXIT / HOLD
//
// Confidence is computed from the absolute Z-score magnitude:
//   confidence = min(|Z| / Z_extreme, 1.0)   where Z_extreme = 3.0
//
// ASSUMPTIONS
// ───────────
// 1. Prices are stationary in the chosen lookback window.
// 2. Used on individual equities or spread series (pairs trading).
// 3. Does NOT work in strong trending regimes — apply only after confirming
//    mean-reversion conditions (low Hurst exponent, high ADF t-stat).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu = require('../utils/mathUtils');
const C  = require('../config/constants');
const logger = require('../config/logger');

const P = C.STRATEGIES.MEAN_REVERSION;

/**
 * Compute Mean Reversion signal from a price series.
 *
 * @param {number[]} prices  - Array of close prices, ascending chronologically.
 *                             Must have at least P.LOOKBACK elements.
 * @returns {{
 *   signal:     'BUY' | 'SELL' | 'HOLD',
 *   confidence: number,        // 0.0 – 1.0
 *   zScore:     number | null,
 *   mean:       number | null,
 *   stdDev:     number | null,
 *   currentPrice: number,
 *   reason:     string,
 * }}
 */
function generateSignal(prices) {
  if (!Array.isArray(prices) || prices.length < P.LOOKBACK) {
    return {
      signal: 'HOLD', confidence: 0,
      zScore: null, mean: null, stdDev: null,
      currentPrice: prices?.at(-1) ?? null,
      reason: `Insufficient data (need ${P.LOOKBACK}, got ${prices?.length ?? 0})`,
    };
  }

  const window      = prices.slice(-P.LOOKBACK);
  const currentPrice = prices[prices.length - 1];
  const rollingMean = mu.mean(window);
  // Guard: if stdDev is 0 (all prices identical) use a tiny epsilon so
  // z-score is defined. In practice, (currentPrice - mean) will also be 0,
  // so z will still be 0 — but a future price outside the flat window will
  // produce a finite z rather than a division-by-zero NaN.
  const rawStd     = mu.stdDev(window);
  const rollingStd  = rawStd === 0 ? 1e-6 : rawStd;
  const z           = (currentPrice - rollingMean) / rollingStd;

  // Confidence scales linearly with Z-score magnitude, capped at 1.0
  const Z_EXTREME   = 3.0;
  const rawConf     = Math.abs(z) / Z_EXTREME;
  const confidence  = mu.clamp(rawConf, 0, 1);

  let signal, reason;

  if (z < P.Z_BUY_THRESHOLD) {
    signal = 'BUY';
    reason = `Z-score ${z.toFixed(3)} < ${P.Z_BUY_THRESHOLD} — price ${currentPrice.toFixed(2)} is ${Math.abs(z).toFixed(2)}σ below mean ${rollingMean.toFixed(2)}`;
  } else if (z > P.Z_SELL_THRESHOLD) {
    signal = 'SELL';
    reason = `Z-score ${z.toFixed(3)} > ${P.Z_SELL_THRESHOLD} — price ${currentPrice.toFixed(2)} is ${z.toFixed(2)}σ above mean ${rollingMean.toFixed(2)}`;
  } else {
    signal = 'HOLD';
    reason = `Z-score ${z.toFixed(3)} within ±${P.Z_SELL_THRESHOLD} band — no actionable deviation`;
  }

  logger.debug(`[MeanReversion] ${signal} | Z=${z.toFixed(4)} | conf=${confidence.toFixed(3)} | reason: ${reason}`);

  return {
    signal,
    confidence: parseFloat(confidence.toFixed(4)),
    zScore:     parseFloat(z.toFixed(6)),
    mean:       parseFloat(rollingMean.toFixed(4)),
    stdDev:     parseFloat(rawStd.toFixed(4)),   // report actual stdDev, not epsilon
    currentPrice,
    reason,
  };
}

/**
 * Batch: generate signals for multiple symbols.
 * Each entry in symbolPrices: { symbol: string, prices: number[] }
 *
 * @returns {Map<string, Object>}
 */
function generateSignals(symbolPrices) {
  const results = new Map();
  for (const { symbol, prices } of symbolPrices) {
    results.set(symbol, generateSignal(prices));
  }
  return results;
}

/**
 * Describe the strategy for API documentation.
 */
function describe() {
  return {
    name: 'Mean Reversion (Z-score)',
    parameters: P,
    description: 'Buys when price is 2+ standard deviations below rolling mean; sells when 2+ above. Uses a 20-day rolling window.',
    assumedMarketRegime: 'Range-bound / mean-reverting',
    limitations: ['Performs poorly in trending markets', 'Window length is sensitive parameter'],
  };
}

module.exports = { generateSignal, generateSignals, describe };
