// src/engine/regimeDetector.js
// ─────────────────────────────────────────────────────────────────────────────
// Market Regime Detection — Stable Edition
//
// ═══════════════════════════════════════════════════════════════════════════
// ROOT CAUSE: WHY THE ORIGINAL WAS NOISY
// ═══════════════════════════════════════════════════════════════════════════
//
// The original detectRegime() was purely stateless. Every bar, it re-ran
// ADX + MA slope + vol percentile from scratch, then immediately declared
// whichever regime the raw indicators pointed at. This caused:
//
//   Bar 100: ADX = 26.1 → TRENDING
//   Bar 101: ADX = 24.8 → SIDEWAYS   ← flip on a 1.3-point move
//   Bar 102: ADX = 25.3 → TRENDING   ← flip back
//
// In practice this triggers a strategy weight change every few bars,
// which means the aggregator constantly re-routes signals — even when
// the underlying market hasn't fundamentally changed character.
//
// ═══════════════════════════════════════════════════════════════════════════
// FOUR-LAYER FIX
// ═══════════════════════════════════════════════════════════════════════════
//
// LAYER 1 — STRENGTH SMOOTHING (EMA on raw trend score)
// ───────────────────────────────────────────────────────
// Instead of using raw ADX/slope directly for regime classification, we
// feed them into a single "trend strength score" in [0,1] and apply a
// short EMA over it. This removes bar-to-bar noise before classification.
//
//   rawStrength_t = f(ADX, maSlope, volPct)
//   smoothedStrength_t = α × rawStrength_t + (1-α) × smoothedStrength_{t-1}
//   α = 2 / (smoothPeriod + 1)   default smoothPeriod = 5
//
// LAYER 2 — THRESHOLD BANDS WITH DEAD ZONE (Hysteresis)
// ───────────────────────────────────────────────────────
// Single thresholds cause flip-flopping at the boundary. Replacing them
// with two-band hysteresis:
//
//   strength ≥ UPPER_BAND (0.60) → TRENDING  (enter trending)
//   strength ≤ LOWER_BAND (0.35) → SIDEWAYS  (enter sideways)
//   LOWER_BAND < strength < UPPER_BAND → HOLD PREVIOUS REGIME
//
// The dead zone between 0.35 and 0.60 absorbs normal indicator noise.
// The market must make a definitive move to trigger a regime change.
//
// LAYER 3 — CONFIRMATION WINDOW
// ───────────────────────────────
// Even after the smoothed score crosses a band, we don't switch until
// the signal has held for MIN_CONFIRM_BARS (default 3). This prevents
// a single spike from triggering a change.
//
//   pendingRegime + pendingCount tracks "this regime has been signalled N bars"
//   Only when pendingCount >= MIN_CONFIRM_BARS does the regime actually change.
//
// LAYER 4 — LOCKOUT PERIOD
// ─────────────────────────
// After a regime switch, a LOCKOUT_BARS cooldown prevents another switch
// for that many bars. Protects against choppy markets that repeatedly
// hover near the band boundary.
//
// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
//
// State is per-symbol and stored in a module-level Map. This means:
//   • Multiple symbols run independently with their own hysteresis
//   • Calling detectRegime('RELIANCE', closes) and detectRegime('TCS', closes)
//     maintain completely separate state machines
//   • resetState(symbol) or resetState() clears all state for testing
//
// For stateless (legacy) behaviour, call detectRegimeStateless(closes)
// which is the original function signature with no side effects.
//
// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT CONTRACT (backward-compatible + new fields)
// ═══════════════════════════════════════════════════════════════════════════
//
//   {
//     regime:       'TRENDING' | 'SIDEWAYS' | 'VOLATILE' | 'UNKNOWN',
//     strength:     number [0,1],   ← smoothed trend strength
//     confidence:   number [0,1],   ← how far from band boundary we are
//     direction:    'UP' | 'DOWN' | 'FLAT' | null,
//     adx:          number | null,
//     maSlope:      number | null,
//     volPercentile:number | null,
//     realisedVol:  number | null,
//     weights:      Object,         ← strategy weight adjustments
//     // Debug / transparency fields:
//     rawStrength:  number,         ← pre-smoothing score
//     hysteresis:   Object,         ← band state info
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

// ── Config (with safe fallbacks if REGIME section is absent) ─────────────────
const RC = C.REGIME || {};

const CFG = Object.freeze({
  ADX_PERIOD:        RC.ADX_PERIOD        || 14,
  SLOPE_PERIOD:      RC.SLOPE_PERIOD      || 20,
  TREND_ADX_MIN:     RC.TREND_ADX_MIN     || 25,
  SIDEWAYS_ADX_MAX:  RC.SIDEWAYS_ADX_MAX  || 20,
  VOL_PERCENTILE_HI: RC.VOL_PERCENTILE_HI || 0.75,
  VOL_PERCENTILE_LO: RC.VOL_PERCENTILE_LO || 0.25,
  SLOPE_THRESHOLD:   RC.SLOPE_THRESHOLD   || 0.001,

  // NEW: Hysteresis band boundaries
  // strength ≥ UPPER → promote to TRENDING
  // strength ≤ LOWER → demote to SIDEWAYS
  // between → hold previous regime
  HYSTERESIS_UPPER:  parseFloat(process.env.REGIME_HYSTERESIS_UPPER  || '0.60'),
  HYSTERESIS_LOWER:  parseFloat(process.env.REGIME_HYSTERESIS_LOWER  || '0.35'),

  // NEW: EMA smoothing period for raw strength (shorter = more responsive)
  SMOOTH_PERIOD:     parseInt(process.env.REGIME_SMOOTH_PERIOD       || '5', 10),

  // NEW: Bars signal must hold before regime actually changes
  MIN_CONFIRM_BARS:  parseInt(process.env.REGIME_MIN_CONFIRM_BARS    || '3', 10),

  // NEW: Bars to wait before another regime switch is allowed
  LOCKOUT_BARS:      parseInt(process.env.REGIME_LOCKOUT_BARS        || '5', 10),
});

// ── Regime enum ───────────────────────────────────────────────────────────────
const REGIME = Object.freeze({
  TRENDING: 'TRENDING',
  SIDEWAYS: 'SIDEWAYS',
  VOLATILE: 'VOLATILE',
  UNKNOWN:  'UNKNOWN',
});

// ── Per-symbol state store ────────────────────────────────────────────────────
// Map<symbol, RegimeState>
const _states = new Map();

/**
 * RegimeState shape:
 * {
 *   currentRegime:   string,   current confirmed regime
 *   smoothedStrength:number,   EMA of raw trend strength
 *   pendingRegime:   string,   regime candidate waiting for confirmation
 *   pendingCount:    number,   consecutive bars the candidate has held
 *   lockoutCount:    number,   bars remaining in post-switch lockout
 *   switchCount:     number,   total number of regime switches (diagnostic)
 *   lastSwitchBar:   number,   bar index of last switch
 * }
 */
function _makeState() {
  return {
    currentRegime:    REGIME.UNKNOWN,
    smoothedStrength: 0.5,  // neutral starting point
    pendingRegime:    null,
    pendingCount:     0,
    lockoutCount:     0,
    switchCount:      0,
    lastSwitchBar:    -999,
  };
}

function _getState(symbol) {
  const key = symbol || '_default';
  if (!_states.has(key)) _states.set(key, _makeState());
  return _states.get(key);
}

/**
 * Reset state for a symbol (or all symbols).
 * Call this in tests for deterministic results.
 * @param {string} [symbol]
 */
function resetState(symbol) {
  if (symbol) _states.delete(symbol || '_default');
  else        _states.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// INDICATOR FUNCTIONS (unchanged from original — no regression)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ADX approximation using close-only Wilder smoothing.
 * @param {number[]} closes
 * @param {number}   period
 * @returns {number|null}  value in [0, 100]
 */
function computeADX(closes, period = CFG.ADX_PERIOD) {
  if (!Array.isArray(closes) || closes.length < period * 2 + 1) return null;

  const tail  = closes.slice(-period * 3);
  const posDM = [], negDM = [], tr = [];

  for (let i = 1; i < tail.length; i++) {
    const diff = tail[i] - tail[i - 1];
    posDM.push(Math.max(diff, 0));
    negDM.push(Math.max(-diff, 0));
    tr.push(Math.abs(diff));
  }

  function wilderSmooth(arr, p) {
    if (arr.length < p) return null;
    let s = arr.slice(0, p).reduce((a, v) => a + v, 0);
    for (let i = p; i < arr.length; i++) s = s - s / p + arr[i];
    return s;
  }

  const sTR = wilderSmooth(tr, period), sPDM = wilderSmooth(posDM, period), sNDM = wilderSmooth(negDM, period);
  if (!sTR || sTR === 0) return null;

  const diPlus  = (sPDM / sTR) * 100;
  const diMinus = (sNDM / sTR) * 100;
  const diSum   = diPlus + diMinus;
  return parseFloat((diSum === 0 ? 0 : Math.abs(diPlus - diMinus) / diSum * 100).toFixed(2));
}

/**
 * MA slope: rate-of-change of the 50-bar SMA over `slopePeriod` bars.
 * @returns {number|null}  signed fraction per bar
 */
function computeMASlope(closes, maPeriod = 50, slopePeriod = CFG.SLOPE_PERIOD) {
  if (closes.length < maPeriod + slopePeriod) return null;
  const now  = mu.sma(closes, maPeriod);
  const past = mu.sma(closes.slice(0, closes.length - slopePeriod), maPeriod);
  if (!now || !past || past === 0) return null;
  return parseFloat(((now - past) / past / slopePeriod).toFixed(8));
}

/**
 * Volatility percentile of current 21-bar realised vol vs trailing history.
 * @returns {number|null}  [0, 1]
 */
function computeVolPercentile(closes, windowBars = 252) {
  if (closes.length < 22) return null;
  const recentVol = mu.annualisedVol(closes.slice(-21));
  if (recentVol == null) return null;

  const volHistory = [];
  for (let i = 21; i < Math.min(closes.length, windowBars); i += 5) {
    const v = mu.annualisedVol(closes.slice(i - 21, i + 1));
    if (v != null) volHistory.push(v);
  }
  if (volHistory.length < 5) return null;
  volHistory.sort((a, b) => a - b);
  return parseFloat((volHistory.filter(v => v <= recentVol).length / volHistory.length).toFixed(4));
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: Raw strength score  [0, 1]
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a single "trending strength" score in [0, 1] from multiple indicators.
 *
 * 0 = purely sideways/ranging
 * 1 = extremely strong trend
 *
 * Components (each normalised to [0,1], then averaged):
 *   ADX component:   (ADX - SIDEWAYS_MAX) / (TREND_MIN + 15 - SIDEWAYS_MAX)  clamped
 *   Slope component: |maSlope| / (SLOPE_THRESHOLD × 3)  clamped
 *
 * Volatile regime is handled separately before this score is used.
 */
function _computeRawStrength(adx, maSlope) {
  let total = 0, count = 0;

  if (adx != null) {
    const adxNorm = mu.clamp(
      (adx - CFG.SIDEWAYS_ADX_MAX) / (CFG.TREND_ADX_MIN + 15 - CFG.SIDEWAYS_ADX_MAX),
      0, 1
    );
    total += adxNorm;
    count++;
  }

  if (maSlope != null) {
    const slopeNorm = mu.clamp(Math.abs(maSlope) / (CFG.SLOPE_THRESHOLD * 3), 0, 1);
    total += slopeNorm;
    count++;
  }

  return count > 0 ? parseFloat((total / count).toFixed(6)) : 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2+3+4: Hysteresis state machine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply EMA smoothing to raw strength and run the hysteresis state machine.
 * Mutates `state` in place.
 *
 * Returns { newRegime, changed, smoothedStrength, confidence }
 */
function _applyHysteresis(state, rawStrength, barIndex) {
  // ── Layer 1: EMA smoothing ────────────────────────────────────────────
  const alpha = 2 / (CFG.SMOOTH_PERIOD + 1);
  state.smoothedStrength = alpha * rawStrength + (1 - alpha) * state.smoothedStrength;
  const s = state.smoothedStrength;

  // ── Decrement lockout ─────────────────────────────────────────────────
  if (state.lockoutCount > 0) state.lockoutCount--;

  // ── Determine candidate regime from banded thresholds ────────────────
  let candidate;
  if (s >= CFG.HYSTERESIS_UPPER) {
    candidate = REGIME.TRENDING;
  } else if (s <= CFG.HYSTERESIS_LOWER) {
    candidate = REGIME.SIDEWAYS;
  } else {
    // Dead zone: candidate = current regime (stay put)
    candidate = state.currentRegime === REGIME.UNKNOWN ? REGIME.SIDEWAYS : state.currentRegime;
  }

  // ── Layer 3: Confirmation window ──────────────────────────────────────
  if (candidate !== state.currentRegime) {
    // Track how long this candidate has been signalled
    if (candidate === state.pendingRegime) {
      state.pendingCount++;
    } else {
      state.pendingRegime = candidate;
      state.pendingCount  = 1;
    }
  } else {
    // Candidate matches current — reset pending
    state.pendingRegime = null;
    state.pendingCount  = 0;
  }

  // ── Layer 4: Decide whether to switch ─────────────────────────────────
  let changed = false;
  const confirmed = state.pendingCount >= CFG.MIN_CONFIRM_BARS;
  const notLocked  = state.lockoutCount === 0;

  if (confirmed && notLocked && state.pendingRegime !== state.currentRegime) {
    state.currentRegime   = state.pendingRegime;
    state.pendingRegime   = null;
    state.pendingCount    = 0;
    state.lockoutCount    = CFG.LOCKOUT_BARS;
    state.switchCount++;
    state.lastSwitchBar   = barIndex;
    changed = true;
  }

  // ── Confidence: distance from nearest band boundary ───────────────────
  // Higher = further from the dead zone = more confident in current regime
  let confidence;
  if (state.currentRegime === REGIME.TRENDING) {
    confidence = mu.clamp((s - CFG.HYSTERESIS_UPPER) / (1 - CFG.HYSTERESIS_UPPER) + 0.5, 0, 1);
  } else if (state.currentRegime === REGIME.SIDEWAYS) {
    confidence = mu.clamp((CFG.HYSTERESIS_LOWER - s) / CFG.HYSTERESIS_LOWER + 0.5, 0, 1);
  } else {
    confidence = 0.5 - Math.abs(s - 0.5);  // highest confidence when furthest from midpoint
  }

  return {
    regime:          state.currentRegime,
    changed,
    smoothedStrength:parseFloat(s.toFixed(6)),
    confidence:      parseFloat(mu.clamp(confidence, 0, 1).toFixed(4)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION: detectRegime (stateful, per-symbol)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect market regime with full hysteresis + smoothing + confirmation.
 *
 * STATEFUL — maintains regime history per symbol to prevent noisy switching.
 * For stateless (one-off) use, call detectRegimeStateless().
 *
 * @param {number[]} closes  Close prices ascending, ≥ 60 required
 * @param {string}   symbol  Symbol key for state isolation (default '_default')
 * @param {number}   barIndex Optional bar index for lockout tracking
 * @returns {{
 *   regime:        'TRENDING'|'SIDEWAYS'|'VOLATILE'|'UNKNOWN',
 *   strength:      number,   smoothed [0,1]
 *   confidence:    number,   [0,1]
 *   direction:     'UP'|'DOWN'|'FLAT'|null,
 *   adx:           number|null,
 *   maSlope:       number|null,
 *   volPercentile: number|null,
 *   realisedVol:   number|null,
 *   rawStrength:   number,
 *   weights:       Object,
 *   hysteresis:    Object,
 * }}
 */
function detectRegime(closes, symbol = '_default', barIndex = 0) {
  const _unknown = {
    regime: REGIME.UNKNOWN, strength: 0, confidence: 0,
    direction: null, adx: null, maSlope: null,
    volPercentile: null, realisedVol: null,
    rawStrength: 0, weights: _defaultWeights(),
    hysteresis: { bands: { upper: CFG.HYSTERESIS_UPPER, lower: CFG.HYSTERESIS_LOWER } },
  };

  if (!Array.isArray(closes) || closes.length < 60) return _unknown;

  // ── Compute indicators ────────────────────────────────────────────────
  const adx         = computeADX(closes);
  const maSlope     = computeMASlope(closes);
  const volPct      = computeVolPercentile(closes);
  const realisedVol = mu.annualisedVol(closes.slice(-21));

  // ── VOLATILE override (no hysteresis — acts immediately) ─────────────
  // Volatile regime is a safety flag, not a trading regime.
  // It bypasses hysteresis so high-vol situations are recognised fast.
  if (volPct != null && volPct >= CFG.VOL_PERCENTILE_HI) {
    const conf = mu.clamp((volPct - CFG.VOL_PERCENTILE_HI) / (1 - CFG.VOL_PERCENTILE_HI), 0, 1);
    const state = _getState(symbol);
    const dir   = _direction(maSlope);

    logger.debug(`[Regime:${symbol}] VOLATILE override | volPct=${volPct.toFixed(2)} conf=${(conf*100).toFixed(0)}%`);

    return {
      regime: REGIME.VOLATILE, strength: volPct, confidence: parseFloat(conf.toFixed(4)),
      direction: dir, adx, maSlope, volPercentile: volPct, realisedVol,
      rawStrength: volPct,
      weights: _regimeWeights(REGIME.VOLATILE, conf),
      hysteresis: { bands: { upper: CFG.HYSTERESIS_UPPER, lower: CFG.HYSTERESIS_LOWER },
                   switchCount: state.switchCount, inLockout: state.lockoutCount > 0 },
    };
  }

  // ── Compute raw trend strength then apply hysteresis ─────────────────
  const rawStrength = _computeRawStrength(adx, maSlope);
  const state       = _getState(symbol);
  const { regime, changed, smoothedStrength, confidence } =
    _applyHysteresis(state, rawStrength, barIndex);

  const direction = _direction(maSlope);
  const weights   = _regimeWeights(regime, confidence);

  logger.debug(
    `[Regime:${symbol}] ${regime}${changed ? ' ← CHANGED' : ''} | ` +
    `raw=${rawStrength.toFixed(3)} smooth=${smoothedStrength.toFixed(3)} conf=${(confidence*100).toFixed(0)}% | ` +
    `ADX=${adx?.toFixed(1) ?? 'N/A'} slope=${maSlope?.toFixed(5) ?? 'N/A'} | ` +
    `pending=${state.pendingRegime ?? '-'}×${state.pendingCount} lockout=${state.lockoutCount}`
  );

  return {
    regime,
    strength:      smoothedStrength,
    confidence,
    direction,
    adx,
    maSlope,
    volPercentile: volPct,
    realisedVol,
    rawStrength:   parseFloat(rawStrength.toFixed(6)),
    weights,
    hysteresis: {
      bands:       { upper: CFG.HYSTERESIS_UPPER, lower: CFG.HYSTERESIS_LOWER },
      changed,
      switchCount: state.switchCount,
      pendingRegime: state.pendingRegime,
      pendingCount:  state.pendingCount,
      inLockout:   state.lockoutCount > 0,
      lockoutRemaining: state.lockoutCount,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATELESS VARIANT (backward-compatible alias)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One-shot regime detection with no state side-effects.
 * Identical output shape to the original detectRegime().
 * Use this for backtesting where you manage state externally,
 * or anywhere you need a pure function.
 */
function detectRegimeStateless(closes) {
  if (!Array.isArray(closes) || closes.length < 60) {
    return {
      regime: REGIME.UNKNOWN, adx: null, maSlope: null,
      volPercentile: null, realisedVol: null,
      direction: null, confidence: 0, strength: 0, weights: _defaultWeights(),
    };
  }

  const adx         = computeADX(closes);
  const maSlope     = computeMASlope(closes);
  const volPct      = computeVolPercentile(closes);
  const realisedVol = mu.annualisedVol(closes.slice(-21));

  let regime = REGIME.UNKNOWN, confidence = 0;

  if (volPct != null && volPct >= CFG.VOL_PERCENTILE_HI) {
    regime     = REGIME.VOLATILE;
    confidence = mu.clamp((volPct - CFG.VOL_PERCENTILE_HI) / (1 - CFG.VOL_PERCENTILE_HI), 0, 1);
  } else {
    const raw = _computeRawStrength(adx, maSlope);
    if (raw >= CFG.HYSTERESIS_UPPER) {
      regime     = REGIME.TRENDING;
      confidence = mu.clamp((raw - CFG.HYSTERESIS_UPPER) / (1 - CFG.HYSTERESIS_UPPER), 0, 1);
    } else if (raw <= CFG.HYSTERESIS_LOWER) {
      regime     = REGIME.SIDEWAYS;
      confidence = mu.clamp((CFG.HYSTERESIS_LOWER - raw) / CFG.HYSTERESIS_LOWER, 0, 1);
    } else {
      regime     = REGIME.UNKNOWN;
      confidence = 0;
    }
  }

  return {
    regime, strength: confidence, confidence,
    direction:    _direction(maSlope),
    adx, maSlope, volPercentile: volPct, realisedVol,
    weights:      _regimeWeights(regime, confidence),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function _direction(maSlope) {
  if (maSlope == null) return null;
  return maSlope >  CFG.SLOPE_THRESHOLD ? 'UP'   :
         maSlope < -CFG.SLOPE_THRESHOLD ? 'DOWN' : 'FLAT';
}

/**
 * Strategy weights per regime.
 * confidence scales the shift: 0 = base weights, 1 = full shift.
 */
function _regimeWeights(regime, confidence = 0.5) {
  const base = { MEAN_REVERSION: 0.35, MA_CROSSOVER: 0.35, RSI: 0.30 };
  const adj  = confidence * 0.5;

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

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC: Regime switch frequency counter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Count regime switches across a full price series.
 * Useful for comparing noisy vs stable detector in backtests.
 *
 * @param {number[]} closes
 * @param {string}   symbol     Unique key for this test run
 * @param {boolean}  stateful   true = hysteresis, false = original behaviour
 * @returns {{ switches: number, regimes: string[], switchRate: number }}
 */
function countSwitches(closes, symbol = '_count_test', stateful = true) {
  resetState(symbol);
  const regimes = [];
  const minBars = 61;

  for (let i = minBars; i <= closes.length; i++) {
    const result = stateful
      ? detectRegime(closes.slice(0, i), symbol, i)
      : detectRegimeStateless(closes.slice(0, i));
    regimes.push(result.regime);
  }

  let switches = 0;
  for (let i = 1; i < regimes.length; i++) {
    if (regimes[i] !== regimes[i - 1]) switches++;
  }

  resetState(symbol);
  return {
    switches,
    bars:       regimes.length,
    regimes,
    switchRate: regimes.length > 0 ? parseFloat((switches / regimes.length).toFixed(4)) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  detectRegime,
  detectRegimeStateless,
  computeADX,
  computeMASlope,
  computeVolPercentile,
  countSwitches,
  resetState,
  REGIME,
  CFG,
};
