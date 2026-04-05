// src/strategies/aggregator.js — REGIME-AWARE UPGRADE
// ─────────────────────────────────────────────────────────────────────────────
// Multi-Strategy Signal Aggregator with Regime Detection Integration
//
// WHAT CHANGED FROM ORIGINAL
// ───────────────────────────
// 1. Bollinger Bands added as a 4th strategy (was unused)
// 2. Regime detection now dynamically adjusts ALL 4 strategy weights
// 3. Bollinger mode (mean_reversion vs breakout) switches per regime
// 4. `aggregate()` now accepts `{ symbol }` option for stateful smoothing
// 5. Regime info exposed in the return object (transparent to API consumers)
// 6. `overrideWeights` still supported (backward compatible)
//
// AGGREGATION FLOW
// ─────────────────
//   1. detectRegime(closes, symbol) → regime + weights
//   2. Run all 4 strategy signal generators
//   3. Apply regime weights to each strategy's (direction × confidence)
//   4. Weighted sum → normalised score → threshold → BUY/SELL/HOLD
//   5. Expose regime, weights, and strategy components in response
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const meanReversion  = require('./meanReversion');
const maCrossover    = require('./maCrossover');
const rsiStrategy    = require('./rsiStrategy');
const bollingerBands = require('./bollingerBands');
const mu             = require('../utils/mathUtils');
const C              = require('../config/constants');
const logger         = require('../config/logger');
const { detectRegime, REGIME } = require('../engine/regimeDetector');

const CONFIG_WEIGHTS   = C.STRATEGY_WEIGHTS;
const SIGNAL_DIRECTION = { BUY: 1, SELL: -1, HOLD: 0 };

// Minimum weighted score to commit to BUY or SELL (vs HOLD)
const SCORE_THRESHOLD = 0.20;

// ── Default 4-strategy weights (no regime info) ───────────────────────────────
const DEFAULT_WEIGHTS = Object.freeze({
  MEAN_REVERSION: CONFIG_WEIGHTS.MEAN_REVERSION ?? 0.30,
  MA_CROSSOVER:   CONFIG_WEIGHTS.MA_CROSSOVER   ?? 0.30,
  RSI:            CONFIG_WEIGHTS.RSI             ?? 0.25,
  BOLLINGER:      0.15,
  bollingerMode:  'mean_reversion',
});

/**
 * Generate regime-aware aggregated signal.
 *
 * @param {number[]} prices  - Close prices ascending
 * @param {Object}   opts    - {
 *   method:          'weighted' | 'majority',
 *   symbol:          string,          // for stateful regime smoothing
 *   overrideWeights: Object|null,     // bypass regime detection
 *   useRegime:       boolean,         // default true
 * }
 * @returns {{
 *   signal:      'BUY' | 'SELL' | 'HOLD',
 *   confidence:  number,
 *   score:       number,
 *   components:  Object[],
 *   method:      string,
 *   regime:      Object,   ← NEW: full regime detection result
 *   currentPrice:number,
 *   timestamp:   string,
 * }}
 */
function aggregate(prices, opts = {}) {
  const method         = opts.method         || 'weighted';
  const symbol         = opts.symbol         || '_default';
  const useRegime      = opts.useRegime      !== false;   // default true
  const overrideWeights = opts.overrideWeights || null;

  // ── Run regime detection (or use provided weights) ────────────────────────
  let regimeResult = null;
  let activeWeights = { ...DEFAULT_WEIGHTS };

  if (overrideWeights) {
    // Caller explicitly provides weights — skip regime detection
    activeWeights = {
      MEAN_REVERSION: overrideWeights.MEAN_REVERSION ?? DEFAULT_WEIGHTS.MEAN_REVERSION,
      MA_CROSSOVER:   overrideWeights.MA_CROSSOVER   ?? DEFAULT_WEIGHTS.MA_CROSSOVER,
      RSI:            overrideWeights.RSI             ?? DEFAULT_WEIGHTS.RSI,
      BOLLINGER:      overrideWeights.BOLLINGER       ?? DEFAULT_WEIGHTS.BOLLINGER,
      bollingerMode:  overrideWeights.bollingerMode   ?? 'mean_reversion',
    };
  } else if (useRegime && prices.length >= 60) {
    regimeResult  = detectRegime(prices, symbol);
    activeWeights = {
      MEAN_REVERSION: regimeResult.weights.MEAN_REVERSION,
      MA_CROSSOVER:   regimeResult.weights.MA_CROSSOVER,
      RSI:            regimeResult.weights.RSI,
      BOLLINGER:      regimeResult.weights.BOLLINGER   ?? DEFAULT_WEIGHTS.BOLLINGER,
      bollingerMode:  regimeResult.weights.bollingerMode ?? 'mean_reversion',
    };
  }

  // ── Run all 4 strategies ──────────────────────────────────────────────────
  const mrResult  = meanReversion.generateSignal(prices);
  const maResult  = maCrossover.generateSignal(prices);
  const rsiResult = rsiStrategy.generateSignal(prices);
  const bbResult  = bollingerBands.generateSignal(prices, {
    mode: activeWeights.bollingerMode,  // ← regime switches BB mode
  });

  const components = [
    { strategy: 'MEAN_REVERSION', weight: activeWeights.MEAN_REVERSION, ...mrResult  },
    { strategy: 'MA_CROSSOVER',   weight: activeWeights.MA_CROSSOVER,   ...maResult  },
    { strategy: 'RSI',            weight: activeWeights.RSI,            ...rsiResult },
    { strategy: 'BOLLINGER',      weight: activeWeights.BOLLINGER,      ...bbResult  },
  ];

  // ── Aggregate ─────────────────────────────────────────────────────────────
  let finalSignal, finalConf, score;

  if (method === 'majority') {
    ({ signal: finalSignal, confidence: finalConf, score } = majorityVote(components));
  } else {
    ({ signal: finalSignal, confidence: finalConf, score } = weightedScore(components));
  }

  logger.info(
    `[Aggregator:${symbol}] ${finalSignal} | score=${score.toFixed(4)} | conf=${finalConf.toFixed(3)} | ` +
    `regime=${regimeResult?.regime ?? 'N/A'}(${((regimeResult?.strength ?? 0) * 100).toFixed(0)}%) | ` +
    `[MR:${mrResult.signal} MA:${maResult.signal} RSI:${rsiResult.signal} BB:${bbResult.signal}]`
  );

  return {
    signal:      finalSignal,
    confidence:  parseFloat(finalConf.toFixed(4)),
    score:       parseFloat(score.toFixed(6)),
    components:  components.map(({ strategy, weight, signal, confidence, reason }) => ({
      strategy, weight: parseFloat(weight.toFixed(4)), signal, confidence,
      reason: reason || undefined,
    })),
    method,
    // ── NEW: expose full regime info ────────────────────────────────────────
    regime: regimeResult ? {
      detected:    regimeResult.regime,
      strength:    regimeResult.strength,
      direction:   regimeResult.direction,
      adx:         regimeResult.adx,
      maSlope:     regimeResult.maSlope,
      atrPct:      regimeResult.atrPct,
      volPercentile: regimeResult.volPercentile,
      weights: {
        MEAN_REVERSION: parseFloat(activeWeights.MEAN_REVERSION.toFixed(4)),
        MA_CROSSOVER:   parseFloat(activeWeights.MA_CROSSOVER.toFixed(4)),
        RSI:            parseFloat(activeWeights.RSI.toFixed(4)),
        BOLLINGER:      parseFloat(activeWeights.BOLLINGER.toFixed(4)),
        bollingerMode:  activeWeights.bollingerMode,
      },
    } : null,
    currentPrice: prices[prices.length - 1],
    timestamp:    new Date().toISOString(),
  };
}

// ─── Weighted Score ───────────────────────────────────────────────────────────

function weightedScore(components) {
  let totalScore  = 0;
  let totalWeight = 0;

  for (const c of components) {
    const direction  = SIGNAL_DIRECTION[c.signal] ?? 0;
    totalScore      += direction * (c.confidence || 0) * c.weight;
    totalWeight     += c.weight;
  }

  const normScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  let signal;
  if      (normScore >  SCORE_THRESHOLD) signal = 'BUY';
  else if (normScore < -SCORE_THRESHOLD) signal = 'SELL';
  else                                   signal = 'HOLD';

  const confidence = mu.clamp(Math.abs(normScore), 0, 1);
  return { signal, confidence, score: normScore };
}

// ─── Majority Voting ──────────────────────────────────────────────────────────

function majorityVote(components) {
  const votes   = { BUY: 0, SELL: 0, HOLD: 0 };
  const confSum = { BUY: 0, SELL: 0, HOLD: 0 };
  let score = 0;

  for (const c of components) {
    votes[c.signal]++;
    confSum[c.signal] += (c.confidence || 0);
    score += (SIGNAL_DIRECTION[c.signal] ?? 0) * (c.confidence || 0) * c.weight;
  }

  let signal     = 'HOLD';
  const maxVotes = Math.max(votes.BUY, votes.SELL, votes.HOLD);
  if (votes.BUY  === maxVotes && votes.BUY  > votes.SELL)  signal = 'BUY';
  if (votes.SELL === maxVotes && votes.SELL > votes.BUY)   signal = 'SELL';

  const n = votes[signal] || 1;
  const confidence = mu.clamp(confSum[signal] / n, 0, 1);
  return { signal, confidence, score };
}

/**
 * Describe all strategy weights and regime integration.
 */
function describeWeights() {
  return {
    weights:          DEFAULT_WEIGHTS,
    threshold:        SCORE_THRESHOLD,
    regimeIntegration: true,
    regimeStrategies: {
      TRENDING:  'Boosts MA_CROSSOVER, reduces MEAN_REVERSION; switches BOLLINGER to breakout mode',
      SIDEWAYS:  'Boosts MEAN_REVERSION + BOLLINGER (mean-reversion mode), reduces MA_CROSSOVER',
      VOLATILE:  'Reduces all weights, boosts RSI for extreme readings',
      UNKNOWN:   'Uses balanced default weights',
    },
    strategies: [
      meanReversion.describe(),
      maCrossover.describe(),
      rsiStrategy.describe(),
      bollingerBands.describe(),
    ],
  };
}

module.exports = { aggregate, describeWeights };
