// src/strategies/maCrossover.js
// ─────────────────────────────────────────────────────────────────────────────
// Moving Average Crossover Strategy (50 / 200 SMA)
//
// MATHEMATICAL BASIS
// ──────────────────
// SMA_N(t) = (1/N) Σ_{i=0}^{N-1} P_{t-i}
//
// GOLDEN CROSS  — fast SMA (50) crosses ABOVE slow SMA (200) → bullish trend
// DEATH  CROSS  — fast SMA (50) crosses BELOW slow SMA (200) → bearish trend
//
// Signal logic:
//   - Current: fast > slow AND previous: fast ≤ slow → FRESH BUY  (crossover just happened)
//   - Current: fast < slow AND previous: fast ≥ slow → FRESH SELL (crossover just happened)
//   - Persistent fast > slow  → HOLD BUY  (trend continuation)
//   - Persistent fast < slow  → HOLD SELL (trend continuation)
//
// Confidence = normalised gap between MAs:
//   gap_pct   = (fast - slow) / slow
//   confidence = clamp(|gap_pct| / 0.05, 0, 1)
//   A 5 % gap between MAs → full confidence
//
// WHY THIS WORKS (in theory)
// ──────────────────────────
// The 200-day SMA smooths out short-term noise; the 50-day captures medium
// trend. Their cross is a regime-change signal: from distribution of capital
// out of (or into) a trend. This is a lagging indicator by design — it confirms
// a trend rather than predicting one.
//
// LIMITATIONS
// ───────────
// 1. High lag — often misses the first 10–15 % of a move.
// 2. Whipsaws in sideways markets.
// 3. Requires >200 bars of history.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu = require('../utils/mathUtils');
const C  = require('../config/constants');
const logger = require('../config/logger');

const P = C.STRATEGIES.MA_CROSSOVER;

/**
 * Compute MA Crossover signal.
 *
 * @param {number[]} prices  - Close prices, ascending. Min length: P.SLOW_PERIOD + 1
 * @returns {{
 *   signal:     'BUY' | 'SELL' | 'HOLD',
 *   confidence: number,
 *   maFast:     number | null,
 *   maSlow:     number | null,
 *   maFastPrev: number | null,
 *   maSlowPrev: number | null,
 *   crossoverType: 'GOLDEN_CROSS' | 'DEATH_CROSS' | 'NONE',
 *   currentPrice: number,
 *   reason:     string,
 * }}
 */
function generateSignal(prices) {
  if (!Array.isArray(prices) || prices.length < P.SLOW_PERIOD + 1) {
    return {
      signal: 'HOLD', confidence: 0,
      maFast: null, maSlow: null,
      maFastPrev: null, maSlowPrev: null,
      crossoverType: 'NONE',
      currentPrice: prices?.at(-1) ?? null,
      reason: `Insufficient data (need ${P.SLOW_PERIOD + 1}, got ${prices?.length ?? 0})`,
    };
  }

  const currentPrice = prices[prices.length - 1];

  // Current MAs (over last fast/slow elements)
  const maFast = mu.sma(prices, P.FAST_PERIOD);
  const maSlow = mu.sma(prices, P.SLOW_PERIOD);

  // Previous MAs (drop last element)
  const prev = prices.slice(0, -1);
  const maFastPrev = mu.sma(prev, P.FAST_PERIOD);
  const maSlowPrev = mu.sma(prev, P.SLOW_PERIOD);

  if (maFast === null || maSlow === null || maFastPrev === null || maSlowPrev === null) {
    return {
      signal: 'HOLD', confidence: 0,
      maFast, maSlow, maFastPrev, maSlowPrev,
      crossoverType: 'NONE', currentPrice,
      reason: 'Could not compute one or more MAs',
    };
  }

  // Detect crossover events (the moment the fast crosses the slow)
  const goldenCross = maFastPrev <= maSlowPrev && maFast > maSlow;
  const deathCross  = maFastPrev >= maSlowPrev && maFast < maSlow;

  // Confidence: normalised gap as fraction of slow MA
  const gapPct    = (maFast - maSlow) / maSlow;
  const confidence = mu.clamp(Math.abs(gapPct) / 0.05, 0, 1);

  // Boost confidence on fresh crossover
  const crossoverBoost = (goldenCross || deathCross) ? 0.2 : 0;
  const finalConf = mu.clamp(confidence + crossoverBoost, 0, 1);

  let signal, crossoverType, reason;

  if (goldenCross) {
    signal = 'BUY';
    crossoverType = 'GOLDEN_CROSS';
    reason = `Golden Cross: MA${P.FAST_PERIOD} (${maFast.toFixed(2)}) crossed above MA${P.SLOW_PERIOD} (${maSlow.toFixed(2)})`;
  } else if (deathCross) {
    signal = 'SELL';
    crossoverType = 'DEATH_CROSS';
    reason = `Death Cross: MA${P.FAST_PERIOD} (${maFast.toFixed(2)}) crossed below MA${P.SLOW_PERIOD} (${maSlow.toFixed(2)})`;
  } else if (maFast > maSlow) {
    signal = 'BUY';
    crossoverType = 'NONE';
    reason = `Bullish alignment: MA${P.FAST_PERIOD} (${maFast.toFixed(2)}) > MA${P.SLOW_PERIOD} (${maSlow.toFixed(2)}) by ${(gapPct * 100).toFixed(2)}%`;
  } else if (maFast < maSlow) {
    signal = 'SELL';
    crossoverType = 'NONE';
    reason = `Bearish alignment: MA${P.FAST_PERIOD} (${maFast.toFixed(2)}) < MA${P.SLOW_PERIOD} (${maSlow.toFixed(2)}) by ${(Math.abs(gapPct) * 100).toFixed(2)}%`;
  } else {
    signal = 'HOLD';
    crossoverType = 'NONE';
    reason = 'MAs are equal — no directional bias';
  }

  logger.debug(`[MACrossover] ${signal} | fast=${maFast.toFixed(2)} slow=${maSlow.toFixed(2)} | conf=${finalConf.toFixed(3)} | ${crossoverType}`);

  return {
    signal,
    confidence:    parseFloat(finalConf.toFixed(4)),
    maFast:        parseFloat(maFast.toFixed(4)),
    maSlow:        parseFloat(maSlow.toFixed(4)),
    maFastPrev:    parseFloat(maFastPrev.toFixed(4)),
    maSlowPrev:    parseFloat(maSlowPrev.toFixed(4)),
    crossoverType,
    currentPrice,
    reason,
  };
}

function describe() {
  return {
    name: 'Moving Average Crossover (50/200 SMA)',
    parameters: P,
    description: 'Golden Cross (50 MA above 200 MA) generates BUY; Death Cross generates SELL.',
    assumedMarketRegime: 'Trending',
    limitations: ['Lags price moves by design', 'Whipsaws in sideways markets', 'Needs 200+ bars'],
  };
}

module.exports = { generateSignal, describe };
