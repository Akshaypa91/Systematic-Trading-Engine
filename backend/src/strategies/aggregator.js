// src/strategies/aggregator.js
// ─────────────────────────────────────────────────────────────────────────────
// Multi-Strategy Signal Aggregator
//
// AGGREGATION METHOD: Weighted Score
// ────────────────────────────────────
// Each strategy produces a signal ∈ {BUY=+1, HOLD=0, SELL=-1}
// and a confidence score ∈ [0, 1].
//
// Weighted score per strategy:
//   score_i = direction_i × confidence_i × weight_i
//   total   = Σ score_i   (range: [-1, +1])
//
// Final signal:
//   total > +THRESHOLD  → BUY
//   total < -THRESHOLD  → SELL
//   otherwise           → HOLD
//
// This approach rewards:
//   • Strategies that agree (scores add up)
//   • High-confidence signals (larger contribution)
//   • Configured strategy importance (weights)
//
// MAJORITY VOTING (alternative)
// ──────────────────────────────
// Count BUY / SELL / HOLD votes. Majority wins.
// Tie-break: HOLD (conservative).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const meanReversion = require('./meanReversion');
const maCrossover   = require('./maCrossover');
const rsiStrategy   = require('./rsiStrategy');
const mu            = require('../utils/mathUtils');
const C             = require('../config/constants');
const logger        = require('../config/logger');

const WEIGHTS = C.STRATEGY_WEIGHTS;
const SIGNAL_DIRECTION = { BUY: 1, SELL: -1, HOLD: 0 };

// Minimum weighted score to commit to BUY or SELL (vs HOLD)
const SCORE_THRESHOLD = 0.20;

/**
 * Generate aggregated signal for a symbol.
 *
 * @param {number[]} prices  - Close prices, ascending
 * @param {Object}   opts    - { method: 'weighted' | 'majority' }
 * @returns {{
 *   signal:      'BUY' | 'SELL' | 'HOLD',
 *   confidence:  number,
 *   score:       number,
 *   components:  Object[],
 *   method:      string,
 * }}
 */
function aggregate(prices, opts = {}) {
  const method = opts.method || 'weighted';
  // NEW: Accept regime-adjusted weights from regimeDetector
  const overrideWeights = opts.overrideWeights || null;

  // ── Run all three strategies ─────────────────────────────────────────────
  const mrResult  = meanReversion.generateSignal(prices);
  const maResult  = maCrossover.generateSignal(prices);
  const rsiResult = rsiStrategy.generateSignal(prices);

  // Use regime-adjusted weights if provided (from regimeDetector)
  const activeWeights = overrideWeights || WEIGHTS;
  const components = [
    { strategy: 'MEAN_REVERSION', weight: activeWeights.MEAN_REVERSION ?? WEIGHTS.MEAN_REVERSION, ...mrResult  },
    { strategy: 'MA_CROSSOVER',   weight: activeWeights.MA_CROSSOVER   ?? WEIGHTS.MA_CROSSOVER,   ...maResult  },
    { strategy: 'RSI',            weight: activeWeights.RSI            ?? WEIGHTS.RSI,            ...rsiResult },
  ];

  let finalSignal, finalConf, score;

  if (method === 'majority') {
    ({ signal: finalSignal, confidence: finalConf, score } = majorityVote(components));
  } else {
    ({ signal: finalSignal, confidence: finalConf, score } = weightedScore(components));
  }

  logger.info(
    `[Aggregator] ${finalSignal} | score=${score.toFixed(4)} | conf=${finalConf.toFixed(3)} | ` +
    `[MR:${mrResult.signal} MA:${maResult.signal} RSI:${rsiResult.signal}]`
  );

  return {
    signal:     finalSignal,
    confidence: parseFloat(finalConf.toFixed(4)),
    score:      parseFloat(score.toFixed(6)),
    components: components.map(({ strategy, weight, signal, confidence, reason }) => ({
      strategy, weight, signal, confidence, reason,
    })),
    method,
    currentPrice: prices[prices.length - 1],
    timestamp: new Date().toISOString(),
  };
}

// ─── Weighted Score ───────────────────────────────────────────────────────────

function weightedScore(components) {
  let totalScore = 0;
  let totalWeight = 0;

  for (const c of components) {
    const direction = SIGNAL_DIRECTION[c.signal] ?? 0;
    totalScore  += direction * c.confidence * c.weight;
    totalWeight += c.weight;
  }

  // Normalise — ensures weights don't need to sum to exactly 1.0
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
  const votes = { BUY: 0, SELL: 0, HOLD: 0 };
  const confSum = { BUY: 0, SELL: 0, HOLD: 0 };
  let score = 0;

  for (const c of components) {
    votes[c.signal]++;
    confSum[c.signal] += c.confidence;
    score += SIGNAL_DIRECTION[c.signal] * c.confidence * c.weight;
  }

  let signal = 'HOLD';
  const maxVotes = Math.max(votes.BUY, votes.SELL, votes.HOLD);
  if (votes.BUY  === maxVotes && votes.BUY  > votes.SELL)  signal = 'BUY';
  if (votes.SELL === maxVotes && votes.SELL > votes.BUY)   signal = 'SELL';

  const n = votes[signal] || 1;
  const confidence = mu.clamp(confSum[signal] / n, 0, 1);
  return { signal, confidence, score };
}


/**
 * Describe all strategy weights.
 */
function describeWeights() {
  return {
    weights: WEIGHTS,
    threshold: SCORE_THRESHOLD,
    strategies: [
      meanReversion.describe(),
      maCrossover.describe(),
      rsiStrategy.describe(),
    ],
  };
}

module.exports = { aggregate, describeWeights };
