// src/engine/regimeDetector.js
// ─────────────────────────────────────────────────────────────────────────────
// Market Regime Detection Module — Production Grade
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS A MARKET REGIME?
// ═══════════════════════════════════════════════════════════════════════════
// A "regime" describes the structural behaviour of prices at a point in time.
// The same price series can alternate between:
//
//   TRENDING  — sustained directional momentum. Prices make higher highs /
//               higher lows (uptrend) or lower lows / lower highs (downtrend).
//               Mean-reversion strategies FAIL here — they fight the trend.
//               → Best strategy: MA crossover, momentum, breakout
//
//   SIDEWAYS  — range-bound, oscillating around a mean. No net direction.
//               Momentum strategies generate constant false breakouts.
//               → Best strategy: Mean reversion, Bollinger Bands
//
//   VOLATILE  — high-amplitude, unpredictable moves. Neither trend nor range
//               dominates. Reducing position size is the primary response.
//               → Best strategy: Reduce exposure, wait for regime to clarify
//
//   UNKNOWN   — insufficient price history for any reliable classification.
//               → Use default balanced weights
//
// ═══════════════════════════════════════════════════════════════════════════
// DETECTION METHODOLOGY (3-layer approach)
// ═══════════════════════════════════════════════════════════════════════════
//
// Layer 1: ADX-like Directional Strength (close-only approximation)
// ──────────────────────────────────────────────────────────────────
//   Classic ADX uses True Range (requires H/L). Since we operate on
//   close-only data, we approximate:
//     DM+  = max(close_t - close_{t-1}, 0)   [upward move]
//     DM-  = max(close_{t-1} - close_t, 0)   [downward move]
//     TR   = |close_t - close_{t-1}|          [simplified true range]
//   Wilder-smooth each over `period` bars, then:
//     DI+  = sDM+ / sTR × 100
//     DI-  = sDM- / sTR × 100
//     DX   = |DI+ - DI-| / (DI+ + DI-) × 100
//   ADX ≈ DX (single-pass Wilder smoothing; true ADX smooths DX again)
//
//   Interpretation:
//     ADX > 25  →  Strong trend present (direction irrelevant to ADX)
//     ADX < 20  →  Sideways / weak trend
//     ADX 20-25 →  Transition / ambiguous
//
// Layer 2: MA Slope (trend direction + speed)
// ────────────────────────────────────────────
//   slope = (SMA_N_now - SMA_N_ago) / SMA_N_ago / period
//   A positive large slope confirms uptrend; near-zero confirms flat market.
//   This adds DIRECTION (up/down) which ADX lacks.
//
// Layer 3: ATR-normalised Volatility Percentile
// ──────────────────────────────────────────────
//   True Average True Range (ATR) approximated without H/L:
//     ATR_t = EWM(|close_t - close_{t-1}|, span=period)
//   We compare current ATR to its trailing 252-bar history via percentile rank.
//   Vol ≥ 75th percentile  → VOLATILE regime override
//   Vol ≤ 25th percentile  → Confirm SIDEWAYS (calm, range-bound)
//
// ═══════════════════════════════════════════════════════════════════════════
// SMOOTHING — Avoiding Noisy Regime Switching
// ═══════════════════════════════════════════════════════════════════════════
//   Regime switching without smoothing causes "chatter": the regime flips
//   every few bars, generating excessive strategy weight adjustments.
//
//   Solution: Exponential smoothed regime scores
//     score_smooth_t = α × score_raw_t + (1-α) × score_smooth_{t-1}
//     α = 2/(SMOOTH_PERIOD+1)   default SMOOTH_PERIOD = 5
//
//   The smoothed score is what determines final regime — raw score only
//   informs. This introduces ~SMOOTH_PERIOD/2 bars of lag, acceptable for
//   daily bars (2-3 day lag).
//
//   Additionally, a CONFIRMATION_BARS threshold (default 3) requires the
//   regime to be consistent for N bars before it's declared final.
//
// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT CONTRACT
// ═══════════════════════════════════════════════════════════════════════════
//   {
//     regime:       'TRENDING' | 'SIDEWAYS' | 'VOLATILE' | 'UNKNOWN',
//     strength:     number [0,1],   ← confidence in this regime classification
//     direction:    'UP' | 'DOWN' | 'FLAT' | null,
//     adx:          number | null,
//     maSlope:      number | null,
//     atr:          number | null,
//     atrPct:       number | null,  ← ATR as % of price
//     volPercentile:number | null,
//     realisedVol:  number | null,
//     weights:      { MEAN_REVERSION, MA_CROSSOVER, RSI, BOLLINGER },
//     smoothedScore:number,         ← internal trending score (smoothed)
//   }
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

const RC = C.REGIME || {};

// ── Defaults (fallback if REGIME section missing from constants) ──────────────
const DEFAULT_ADX_PERIOD      = RC.ADX_PERIOD        || 14;
const DEFAULT_SLOPE_PERIOD    = RC.SLOPE_PERIOD       || 20;
const DEFAULT_TREND_ADX_MIN   = RC.TREND_ADX_MIN      || 25;
const DEFAULT_SIDEWAYS_ADX    = RC.SIDEWAYS_ADX_MAX   || 20;
const DEFAULT_VOL_PCT_HI      = RC.VOL_PERCENTILE_HI  || 0.75;
const DEFAULT_VOL_PCT_LO      = RC.VOL_PERCENTILE_LO  || 0.25;
const DEFAULT_SLOPE_THRESHOLD = RC.SLOPE_THRESHOLD     || 0.001;

// Smoothing parameters (prevent noisy regime switching)
const SMOOTH_ALPHA       = 2 / (5 + 1);   // EMA alpha — 5-bar half-life
const CONFIRMATION_BARS  = 3;             // regime must persist N bars to confirm

// ── Regime enum ───────────────────────────────────────────────────────────────
const REGIME = Object.freeze({
  TRENDING:  'TRENDING',
  SIDEWAYS:  'SIDEWAYS',
  VOLATILE:  'VOLATILE',
  UNKNOWN:   'UNKNOWN',
});

// ── Module-level smoothing state ──────────────────────────────────────────────
// Keyed by symbol so multi-symbol callers get independent smoothing.
// Format: Map<symbol, { smoothedScore: number, history: string[], lastRegime: string }>
const _smoothingState = new Map();

/**
 * Get or initialise smoothing state for a symbol.
 * @param {string} symbol
 */
function _getState(symbol) {
  const key = symbol || '_default';
  if (!_smoothingState.has(key)) {
    _smoothingState.set(key, { smoothedScore: 0, history: [], lastRegime: REGIME.UNKNOWN });
  }
  return _smoothingState.get(key);
}

/**
 * Reset smoothing state (e.g., for deterministic tests).
 * @param {string} [symbol] — if omitted, clears ALL symbols
 */
function resetSmoothing(symbol) {
  if (symbol) _smoothingState.delete(symbol || '_default');
  else        _smoothingState.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: ADX-like Directional Strength
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute simplified ADX using close prices only.
 *
 * Uses Wilder smoothing (industry standard for ADX).
 * Close-only approximation: TR = |Δclose|, no high/low required.
 *
 * @param {number[]} closes
 * @param {number}   period   Default 14 (standard ADX period)
 * @returns {number|null}     ADX value in [0,100], or null if insufficient data
 */
function computeADX(closes, period = DEFAULT_ADX_PERIOD) {
  if (!Array.isArray(closes) || closes.length < period * 2 + 1) return null;

  // Use trailing 3×period bars to ensure Wilder smoothing has converged
  const tail   = closes.slice(-period * 3);
  const posDM  = [];
  const negDM  = [];
  const tr     = [];

  for (let i = 1; i < tail.length; i++) {
    const diff = tail[i] - tail[i - 1];
    posDM.push(Math.max(diff,  0));
    negDM.push(Math.max(-diff, 0));
    tr.push(Math.abs(diff));
  }

  // Wilder smoothing: seed with sum of first `period` values, then roll
  function wilderSmooth(arr, p) {
    if (arr.length < p) return null;
    let s = arr.slice(0, p).reduce((a, v) => a + v, 0);
    for (let i = p; i < arr.length; i++) s = s - s / p + arr[i];
    return s;
  }

  const sTR  = wilderSmooth(tr,    period);
  const sPDM = wilderSmooth(posDM, period);
  const sNDM = wilderSmooth(negDM, period);

  if (!sTR || sTR === 0) return null;

  const diPlus  = (sPDM / sTR) * 100;
  const diMinus = (sNDM / sTR) * 100;
  const diSum   = diPlus + diMinus;
  const dx      = diSum === 0 ? 0 : (Math.abs(diPlus - diMinus) / diSum) * 100;

  return parseFloat(dx.toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: MA Slope (trend direction + speed)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute rate of change of the `maPeriod`-bar SMA.
 *
 * slope = (SMA_now - SMA_{N bars ago}) / SMA_{N bars ago} / slopePeriod
 *
 * Positive large slope → uptrend; near-zero → flat; negative → downtrend.
 *
 * @param {number[]} closes
 * @param {number}   maPeriod     MA period (default 50)
 * @param {number}   slopePeriod  Look-back for slope (default 20)
 * @returns {number|null}  slope per bar as a fraction, or null
 */
function computeMASlope(closes, maPeriod = 50, slopePeriod = DEFAULT_SLOPE_PERIOD) {
  if (!Array.isArray(closes) || closes.length < maPeriod + slopePeriod) return null;

  const maRecent = mu.sma(closes, maPeriod);
  const maPast   = mu.sma(closes.slice(0, closes.length - slopePeriod), maPeriod);

  if (!maRecent || !maPast || maPast === 0) return null;
  return parseFloat(((maRecent - maPast) / maPast / slopePeriod).toFixed(8));
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: ATR-normalised Volatility Percentile
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute Average True Range (ATR) approximation using close-only data.
 *
 * ATR_t = EWM(|close_t - close_{t-1}|, period)
 * As a % of price: atrPct = ATR / close × 100
 *
 * @param {number[]} closes
 * @param {number}   period  Smoothing period (default same as ADX_PERIOD)
 * @returns {{ atr: number, atrPct: number }|null}
 */
function computeATR(closes, period = DEFAULT_ADX_PERIOD) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  const k = 2 / (period + 1);  // EMA alpha
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(Math.abs(closes[i] - closes[i - 1]));
  }

  // EMA of absolute changes
  let atr = changes[0];
  for (let i = 1; i < changes.length; i++) {
    atr = changes[i] * k + atr * (1 - k);
  }

  const lastClose = closes[closes.length - 1];
  const atrPct    = lastClose > 0 ? (atr / lastClose) * 100 : null;

  return {
    atr:    parseFloat(atr.toFixed(4)),
    atrPct: atrPct != null ? parseFloat(atrPct.toFixed(4)) : null,
  };
}

/**
 * Compute volatility percentile of current ATR vs trailing 252-bar history.
 *
 * Returns [0,1]:  0.9 = current vol is higher than 90% of recent readings.
 *
 * @param {number[]} closes
 * @param {number}   windowBars  History length for percentile (default 252)
 * @returns {number|null}
 */
function computeVolPercentile(closes, windowBars = 252) {
  if (!Array.isArray(closes) || closes.length < 22) return null;

  const recentVol = mu.annualisedVol(closes.slice(-21));
  if (recentVol == null) return null;

  // Build rolling vol history (sample every 5 bars for efficiency)
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

// ═══════════════════════════════════════════════════════════════════════════
// REGIME WEIGHTS — Strategy allocation per regime
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute regime-adjusted strategy weights.
 *
 * The weight shift is proportional to regime `strength` (confidence).
 * At strength=1.0, weights shift fully to regime-optimal allocation.
 * At strength=0.0, weights remain at balanced defaults.
 *
 * TRENDING:
 *   MA_CROSSOVER   bumped up (momentum follows trend)
 *   MEAN_REVERSION pushed down (mean-reversion fights trend)
 *   BOLLINGER      switches to 'breakout' mode internally
 *
 * SIDEWAYS:
 *   MEAN_REVERSION bumped up (reversion works in range)
 *   BOLLINGER      stays in 'mean_reversion' mode
 *   MA_CROSSOVER   pushed down (crossovers → whipsaws in range)
 *
 * VOLATILE:
 *   All weights reduced proportionally (hold more cash)
 *   RSI boosted for extreme oversold/overbought reads
 *
 * @param {string} regime     REGIME enum value
 * @param {number} strength   [0,1] confidence in the regime
 * @returns {{
 *   MEAN_REVERSION: number,
 *   MA_CROSSOVER:   number,
 *   RSI:            number,
 *   BOLLINGER:      number,
 *   bollingerMode:  'mean_reversion'|'breakout',
 * }}
 */
function computeRegimeWeights(regime, strength = 0.5) {
  // Balanced baseline (no regime info)
  const base = {
    MEAN_REVERSION: 0.30,
    MA_CROSSOVER:   0.30,
    RSI:            0.25,
    BOLLINGER:      0.15,
  };

  const adj = strength * 0.45; // max ±45% adjustment at full strength

  switch (regime) {
    case REGIME.TRENDING:
      return {
        MEAN_REVERSION: Math.max(0.03, base.MEAN_REVERSION - adj * 0.80),
        MA_CROSSOVER:   Math.min(0.65, base.MA_CROSSOVER   + adj * 0.80),
        RSI:            base.RSI,
        BOLLINGER:      Math.max(0.02, base.BOLLINGER - adj * 0.50),
        bollingerMode:  'breakout',   // ← switch BB to momentum mode
      };
    case REGIME.SIDEWAYS:
      return {
        MEAN_REVERSION: Math.min(0.55, base.MEAN_REVERSION + adj * 0.80),
        MA_CROSSOVER:   Math.max(0.03, base.MA_CROSSOVER   - adj * 0.80),
        RSI:            base.RSI,
        BOLLINGER:      Math.min(0.30, base.BOLLINGER + adj * 0.50),
        bollingerMode:  'mean_reversion',
      };
    case REGIME.VOLATILE:
      // Reduce all; boost RSI for extreme readings
      const scale = 1 - adj * 0.40;
      return {
        MEAN_REVERSION: base.MEAN_REVERSION * scale,
        MA_CROSSOVER:   base.MA_CROSSOVER   * scale,
        RSI:            Math.min(0.50, base.RSI * (1 + adj * 0.30)),
        BOLLINGER:      base.BOLLINGER       * scale,
        bollingerMode:  'mean_reversion',
      };
    default:
      return { ...base, bollingerMode: 'mean_reversion' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE: detectRegime
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect market regime from close prices with smoothing.
 *
 * Smoothing prevents noisy regime switching:
 *   • Exponential smoothing of the raw "trending score"
 *   • CONFIRMATION_BARS requirement before regime change
 *
 * @param {number[]} closes  Close prices, ascending, length ≥ 60
 * @param {string}   symbol  Symbol identifier (for stateful smoothing)
 * @returns {{
 *   regime:        'TRENDING'|'SIDEWAYS'|'VOLATILE'|'UNKNOWN',
 *   strength:      number,   [0,1] — how confidently this regime is classified
 *   direction:     'UP'|'DOWN'|'FLAT'|null,
 *   adx:           number|null,
 *   maSlope:       number|null,
 *   atr:           number|null,
 *   atrPct:        number|null,
 *   volPercentile: number|null,
 *   realisedVol:   number|null,
 *   weights:       Object,
 *   smoothedScore: number,
 *   indicators:    Object,   raw indicator values for debugging
 * }}
 */
function detectRegime(closes, symbol = '_default') {
  // ── Insufficient data guard ───────────────────────────────────────────────
  if (!Array.isArray(closes) || closes.length < 60) {
    return {
      regime:        REGIME.UNKNOWN,
      strength:      0,
      direction:     null,
      adx:           null,
      maSlope:       null,
      atr:           null,
      atrPct:        null,
      volPercentile: null,
      realisedVol:   null,
      weights:       computeRegimeWeights(REGIME.UNKNOWN, 0),
      smoothedScore: 0,
      indicators:    {},
    };
  }

  // ── Compute all three layers ──────────────────────────────────────────────
  const adx         = computeADX(closes);
  const maSlope     = computeMASlope(closes);
  const atrResult   = computeATR(closes);
  const volPct      = computeVolPercentile(closes);
  const realisedVol = mu.annualisedVol(closes.slice(-21));

  const atr    = atrResult?.atr    ?? null;
  const atrPct = atrResult?.atrPct ?? null;

  // ── Compute raw "trending score" in [-1, +1] ──────────────────────────────
  // Positive = trending, negative = sideways, magnitude = strength
  let rawScore = 0;
  let scoreComponents = 0;

  if (adx != null) {
    // Normalise ADX to [-1,+1]: +1 at ADX=50, -1 at ADX=0
    const adxScore = mu.clamp((adx - DEFAULT_SIDEWAYS_ADX) /
                              (DEFAULT_TREND_ADX_MIN - DEFAULT_SIDEWAYS_ADX + 15), -1, 1);
    rawScore       += adxScore;
    scoreComponents++;
  }

  if (maSlope != null) {
    // Normalise slope: 0 = flat, ±1 at threshold × 3
    const slopeScore = mu.clamp(Math.abs(maSlope) / (DEFAULT_SLOPE_THRESHOLD * 3), 0, 1);
    // Directional: slope being large means trending (regardless of direction)
    rawScore         += slopeScore;
    scoreComponents++;
  }

  const normRawScore = scoreComponents > 0 ? rawScore / scoreComponents : 0;

  // ── Apply EMA smoothing (avoids noisy switching) ──────────────────────────
  const state = _getState(symbol);
  state.smoothedScore = SMOOTH_ALPHA * normRawScore + (1 - SMOOTH_ALPHA) * state.smoothedScore;
  const smoothed = state.smoothedScore;

  // ── Classify regime from smoothed score + vol percentile ──────────────────
  let rawRegime, rawStrength;

  // VOLATILE check first — overrides trend/sideways
  if (volPct != null && volPct >= DEFAULT_VOL_PCT_HI) {
    rawRegime  = REGIME.VOLATILE;
    rawStrength = mu.clamp((volPct - DEFAULT_VOL_PCT_HI) / (1 - DEFAULT_VOL_PCT_HI), 0, 1);
  }
  // TRENDING: high smoothed score OR confirmed ADX spike
  else if (smoothed >= 0.30 ||
           (adx != null && adx >= DEFAULT_TREND_ADX_MIN)) {
    rawRegime   = REGIME.TRENDING;
    // Strength from both ADX distance above threshold and smoothed score
    let s       = mu.clamp(smoothed / 0.70, 0, 1);
    if (adx != null && adx >= DEFAULT_TREND_ADX_MIN)
      s = Math.max(s, mu.clamp((adx - DEFAULT_TREND_ADX_MIN) / (50 - DEFAULT_TREND_ADX_MIN), 0, 1));
    rawStrength = s;
  }
  // SIDEWAYS: low smoothed score AND low vol
  else if (smoothed <= 0.05 &&
           (volPct == null || volPct <= DEFAULT_VOL_PCT_HI)) {
    rawRegime   = REGIME.SIDEWAYS;
    // Stronger sideways signal when vol is also low
    let s       = mu.clamp((0.30 - smoothed) / 0.30, 0, 1);
    if (volPct != null && volPct <= DEFAULT_VOL_PCT_LO)
      s = Math.min(1, s + 0.20);
    rawStrength = s;
  }
  // Transition / ambiguous
  else {
    rawRegime   = REGIME.UNKNOWN;
    rawStrength = 0;
  }

  // ── Confirmation smoothing: require N bars of consistency ─────────────────
  state.history.push(rawRegime);
  if (state.history.length > CONFIRMATION_BARS + 2)
    state.history.shift();

  // Count how many of the last CONFIRMATION_BARS match rawRegime
  const recent   = state.history.slice(-CONFIRMATION_BARS);
  const matchCnt = recent.filter(r => r === rawRegime).length;
  const confirmed = matchCnt >= Math.ceil(CONFIRMATION_BARS * 0.67);

  // If not yet confirmed, revert to last confirmed regime (stability)
  const finalRegime  = confirmed ? rawRegime : (state.lastRegime || REGIME.UNKNOWN);
  const finalStrength = confirmed ? rawStrength : rawStrength * 0.5;

  if (confirmed) state.lastRegime = rawRegime;

  // ── Direction from MA slope ───────────────────────────────────────────────
  let direction = null;
  if (maSlope != null) {
    direction = maSlope >  DEFAULT_SLOPE_THRESHOLD ? 'UP'   :
                maSlope < -DEFAULT_SLOPE_THRESHOLD ? 'DOWN' : 'FLAT';
  }

  // ── Regime-adjusted strategy weights ─────────────────────────────────────
  const weights = computeRegimeWeights(finalRegime, finalStrength);

  logger.debug(
    `[Regime:${symbol}] ${finalRegime} (strength=${(finalStrength * 100).toFixed(1)}%) | ` +
    `ADX=${adx?.toFixed(1) ?? 'N/A'} slope=${maSlope?.toFixed(5) ?? 'N/A'} ` +
    `atr%=${atrPct?.toFixed(2) ?? 'N/A'} volPct=${volPct?.toFixed(2) ?? 'N/A'} | ` +
    `smoothed=${smoothed.toFixed(3)} dir=${direction} confirmed=${confirmed}`
  );

  return {
    regime:        finalRegime,
    strength:      parseFloat(finalStrength.toFixed(4)),
    direction,
    adx,
    maSlope,
    atr,
    atrPct,
    volPercentile: volPct,
    realisedVol,
    weights,
    smoothedScore: parseFloat(smoothed.toFixed(6)),
    indicators: {
      adx, maSlope, atrPct, volPercentile: volPct,
      realisedVol, rawScore: parseFloat(normRawScore.toFixed(4)),
      smoothedScore: parseFloat(smoothed.toFixed(4)),
      confirmed, matchCount: matchCnt,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REGIME-AWARE AGGREGATE — drop-in enhanced aggregator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convenience: detect regime then return it alongside the optimal
 * strategy routing decision.
 *
 * This is consumed by the aggregator and the signal controller so that
 * strategy selection is transparent in the API response.
 *
 * @param {number[]} closes
 * @param {string}   symbol
 * @returns {{
 *   ...detectRegime result,
 *   recommendedStrategy: string,
 *   bollingerMode:       'mean_reversion'|'breakout',
 * }}
 */
function detectRegimeWithRouting(closes, symbol = '_default') {
  const result = detectRegime(closes, symbol);

  // Map regime → primary recommended strategy
  const strategyMap = {
    [REGIME.TRENDING]:  'MA_CROSSOVER',
    [REGIME.SIDEWAYS]:  'BOLLINGER',   // prefer Bollinger in sideways (mean-reversion)
    [REGIME.VOLATILE]:  'RSI',         // RSI best at extremes in volatile markets
    [REGIME.UNKNOWN]:   'AGGREGATED',
  };

  return {
    ...result,
    recommendedStrategy: strategyMap[result.regime] || 'AGGREGATED',
    bollingerMode:       result.weights.bollingerMode || 'mean_reversion',
  };
}

module.exports = {
  detectRegime,
  detectRegimeWithRouting,
  computeADX,
  computeMASlope,
  computeATR,
  computeVolPercentile,
  computeRegimeWeights,
  resetSmoothing,
  REGIME,
};
