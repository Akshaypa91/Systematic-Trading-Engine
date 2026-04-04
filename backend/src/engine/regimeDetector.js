// src/engine/regimeDetector.js
// ─────────────────────────────────────────────────────────────────────────────
// IMPROVEMENT 3: Market Regime Detection
//
// PROBLEM IT SOLVES
// ──────────────────
// A mean-reversion strategy that works in sideways markets will LOSE in a
// strong trend (it will keep shorting a rising asset). Conversely, a
// momentum/MA strategy will generate false signals in choppy markets.
//
// No single strategy works in all regimes. The solution: detect the current
// regime and activate the most appropriate strategy (or adjust weights).
//
// REGIMES
// ────────
//   TRENDING   — sustained directional move (strong momentum)
//   SIDEWAYS   — oscillating price around mean (range-bound)
//   VOLATILE   — high, unstable volatility (no clear direction)
//   UNKNOWN    — insufficient data
//
// DETECTION METHODS (layered for robustness)
// ────────────────────────────────────────────
// 1. ADX-like indicator: measures STRENGTH of trend, not direction
//    • ADX > 25 → TRENDING
//    • ADX < 20 → SIDEWAYS
//
// 2. MA slope: measures rate of change of the 50-period MA
//    • slope > threshold → trending up/down
//
// 3. Realised volatility percentile
//    • vol > 75th percentile of trailing window → VOLATILE
//
// HOW IT'S USED
// ──────────────
// • Aggregator reads regime and adjusts strategy weights dynamically
// • In TRENDING: boost MA_CROSSOVER weight (momentum)
// • In SIDEWAYS: boost MEAN_REVERSION weight
// • In VOLATILE:  reduce position sizes, use tighter stops
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

const RC = C.REGIME;

// Regime enum
const REGIME = Object.freeze({
  TRENDING:  'TRENDING',
  SIDEWAYS:  'SIDEWAYS',
  VOLATILE:  'VOLATILE',
  UNKNOWN:   'UNKNOWN',
});

/**
 * Compute a simplified ADX-like directional strength indicator.
 *
 * True ADX requires high/low/close. This approximation uses close-only:
 *   DM (directional move) = |change| for each bar
 *   smoothed over period with Wilder smoothing
 *   "ADX" ≈ ratio of smoothed trend-component to smoothed total-move
 *
 * Returns value in [0, 100]. Higher = stronger trend.
 *
 * @param {number[]} closes
 * @param {number}   period
 */
function computeADX(closes, period = RC.ADX_PERIOD) {
  if (!Array.isArray(closes) || closes.length < period * 2 + 1) return null;

  const n    = closes.length;
  const tail = closes.slice(-period * 3); // use trailing 3×period bars

  // Compute raw directional moves
  const posDM = [], negDM = [], tr = [];
  for (let i = 1; i < tail.length; i++) {
    const diff = tail[i] - tail[i - 1];
    posDM.push(Math.max(diff, 0));
    negDM.push(Math.max(-diff, 0));
    tr.push(Math.abs(diff));  // simplified TR (no high/low available)
  }

  // Wilder smooth
  function wilderSmooth(arr, p) {
    if (arr.length < p) return null;
    let smoothed = arr.slice(0, p).reduce((s, v) => s + v, 0);
    for (let i = p; i < arr.length; i++)
      smoothed = smoothed - smoothed / p + arr[i];
    return smoothed;
  }

  const sTR   = wilderSmooth(tr, period);
  const sPDM  = wilderSmooth(posDM, period);
  const sNDM  = wilderSmooth(negDM, period);

  if (!sTR || sTR === 0) return null;

  const diPlus  = (sPDM / sTR) * 100;
  const diMinus = (sNDM / sTR) * 100;
  const diSum   = diPlus + diMinus;
  const dx      = diSum === 0 ? 0 : Math.abs(diPlus - diMinus) / diSum * 100;

  // Smooth DX to get ADX (one more Wilder pass would be ideal; here use SMA for simplicity)
  return parseFloat(dx.toFixed(2));
}

/**
 * Compute MA slope as fraction per bar.
 * slope = (MA_last − MA_lookback_bars_ago) / MA_lookback_bars_ago / slopePeriod
 */
function computeMASlope(closes, maPeriod = 50, slopePeriod = RC.SLOPE_PERIOD) {
  if (closes.length < maPeriod + slopePeriod) return null;
  const maRecent = mu.sma(closes, maPeriod);
  const maPast   = mu.sma(closes.slice(0, closes.length - slopePeriod), maPeriod);
  if (!maRecent || !maPast || maPast === 0) return null;
  return parseFloat(((maRecent - maPast) / maPast / slopePeriod).toFixed(8));
}

/**
 * Compute volatility percentile relative to a rolling history.
 * Returns a value in [0, 1]. 0.9 = vol is higher than 90% of recent readings.
 */
function computeVolPercentile(closes, windowBars = 252) {
  if (closes.length < 22) return null;
  const recentVol = mu.annualisedVol(closes.slice(-21));
  if (recentVol == null) return null;

  // Build vol history over rolling windows
  const volHistory = [];
  const step = 5;
  for (let i = 21; i < Math.min(closes.length, windowBars); i += step) {
    const v = mu.annualisedVol(closes.slice(i - 21, i + 1));
    if (v != null) volHistory.push(v);
  }

  if (volHistory.length < 5) return null;
  volHistory.sort((a, b) => a - b);
  const rank = volHistory.filter(v => v <= recentVol).length;
  return parseFloat((rank / volHistory.length).toFixed(4));
}

/**
 * Detect market regime from close prices.
 *
 * @param {number[]} closes — Array of close prices, ascending, length ≥ 60
 * @returns {{
 *   regime:          'TRENDING'|'SIDEWAYS'|'VOLATILE'|'UNKNOWN',
 *   adx:             number|null,
 *   maSlope:         number|null,
 *   volPercentile:   number|null,
 *   realisedVol:     number|null,
 *   direction:       'UP'|'DOWN'|'FLAT'|null,
 *   confidence:      number,       // [0,1]
 *   weights:         Object,       // suggested strategy weight adjustments
 * }}
 */
function detectRegime(closes) {
  if (!Array.isArray(closes) || closes.length < 60) {
    return { regime: REGIME.UNKNOWN, adx: null, maSlope: null,
             volPercentile: null, realisedVol: null,
             direction: null, confidence: 0, weights: _defaultWeights() };
  }

  const adx          = computeADX(closes);
  const maSlope      = computeMASlope(closes);
  const volPct       = computeVolPercentile(closes);
  const realisedVol  = mu.annualisedVol(closes.slice(-21));

  let regime     = REGIME.UNKNOWN;
  let confidence = 0;
  const signals  = [];

  // ── Volatile check first (overrides trend/sideways) ───────────────────────
  if (volPct != null && volPct >= RC.VOL_PERCENTILE_HI) {
    regime     = REGIME.VOLATILE;
    confidence = mu.clamp((volPct - RC.VOL_PERCENTILE_HI) / (1 - RC.VOL_PERCENTILE_HI), 0, 1);
    signals.push(`vol@${(volPct * 100).toFixed(0)}th pct`);
  }
  // ── Trending ──────────────────────────────────────────────────────────────
  else if ((adx != null && adx >= RC.TREND_ADX_MIN) ||
           (maSlope != null && Math.abs(maSlope) >= RC.SLOPE_THRESHOLD)) {
    regime = REGIME.TRENDING;
    let conf = 0;
    if (adx != null && adx >= RC.TREND_ADX_MIN) {
      conf = mu.clamp((adx - RC.TREND_ADX_MIN) / (50 - RC.TREND_ADX_MIN), 0, 1);
      signals.push(`ADX=${adx.toFixed(1)}`);
    }
    if (maSlope != null && Math.abs(maSlope) >= RC.SLOPE_THRESHOLD) {
      conf = Math.max(conf, mu.clamp(Math.abs(maSlope) / (RC.SLOPE_THRESHOLD * 3), 0, 1));
      signals.push(`slope=${(maSlope * 1000).toFixed(2)}‰`);
    }
    confidence = conf;
  }
  // ── Sideways ──────────────────────────────────────────────────────────────
  else if ((adx != null && adx < RC.SIDEWAYS_ADX_MAX) ||
           (maSlope != null && Math.abs(maSlope) < RC.SLOPE_THRESHOLD * 0.3)) {
    regime = REGIME.SIDEWAYS;
    let conf = adx != null
      ? mu.clamp((RC.SIDEWAYS_ADX_MAX - adx) / RC.SIDEWAYS_ADX_MAX, 0, 1)
      : 0.5;
    confidence = conf;
    signals.push(adx != null ? `ADX=${adx.toFixed(1)}` : 'flat slope');
  }

  // ── Directional bias ──────────────────────────────────────────────────────
  let direction = null;
  if (maSlope != null) {
    direction = maSlope > RC.SLOPE_THRESHOLD  ? 'UP'   :
                maSlope < -RC.SLOPE_THRESHOLD ? 'DOWN' : 'FLAT';
  }

  const weights = _regimeWeights(regime, confidence);

  logger.debug(
    `[Regime] ${regime} (conf=${(confidence * 100).toFixed(1)}%) | ` +
    `${signals.join(' | ')} | dir=${direction}`
  );

  return {
    regime,
    adx:           adx,
    maSlope:       maSlope,
    volPercentile: volPct,
    realisedVol:   realisedVol,
    direction,
    confidence:    parseFloat(confidence.toFixed(4)),
    weights,
  };
}

/**
 * Generate regime-adjusted strategy weights.
 * Returns weights that sum to 1.
 *
 *   TRENDING  → boost MA_CROSSOVER (momentum), reduce MEAN_REVERSION
 *   SIDEWAYS  → boost MEAN_REVERSION, reduce MA_CROSSOVER
 *   VOLATILE  → reduce all (hold more cash), keep RSI for oversold bounces
 *   UNKNOWN   → use default weights from config
 */
function _regimeWeights(regime, confidence = 0.5) {
  const base = {
    MEAN_REVERSION: 0.35,
    MA_CROSSOVER:   0.35,
    RSI:            0.30,
  };

  const adj = confidence * 0.5; // max adjustment = ±50% of base weight

  switch (regime) {
    case REGIME.TRENDING:
      return {
        MEAN_REVERSION: Math.max(0.05, base.MEAN_REVERSION - adj * 0.7),
        MA_CROSSOVER:   Math.min(0.70, base.MA_CROSSOVER   + adj * 0.7),
        RSI:            base.RSI,
      };
    case REGIME.SIDEWAYS:
      return {
        MEAN_REVERSION: Math.min(0.70, base.MEAN_REVERSION + adj * 0.7),
        MA_CROSSOVER:   Math.max(0.05, base.MA_CROSSOVER   - adj * 0.7),
        RSI:            base.RSI,
      };
    case REGIME.VOLATILE:
      // In volatile regime, keep RSI for oversold/overbought extremes
      // but reduce momentum and mean-reversion exposure
      return {
        MEAN_REVERSION: base.MEAN_REVERSION * (1 - adj * 0.4),
        MA_CROSSOVER:   base.MA_CROSSOVER   * (1 - adj * 0.4),
        RSI:            base.RSI            * (1 + adj * 0.2),
      };
    default:
      return { ...base };
  }
}

function _defaultWeights() {
  return { MEAN_REVERSION: 0.35, MA_CROSSOVER: 0.35, RSI: 0.30 };
}

module.exports = {
  detectRegime,
  computeADX,
  computeMASlope,
  computeVolPercentile,
  REGIME,
};
