// src/engine/strategyCore.js
// ─────────────────────────────────────────────────────────────────────────────
// THE single place a trading signal decision is made. Backtest, the /signal
// endpoint, and the live signal engine all call strategyCore.evaluate() so that
// identical bars + identical options ALWAYS produce an identical signal. This is
// the property that makes live results comparable to backtests — historically
// each path dispatched to the strategies slightly differently (regime handling,
// option shapes), so a backtested edge didn't necessarily match live behaviour.
//
// This module ONLY decides the signal. Execution (fills, costs, order routing)
// stays in each caller's adapter — that's *supposed* to differ between backtest
// and live. What must never differ is the decision.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const meanReversion = require('../strategies/meanReversion');
const maCrossover   = require('../strategies/maCrossover');
const rsiStrategy   = require('../strategies/rsiStrategy');
const bollinger     = require('../strategies/bollingerBands');
const aggregator    = require('../strategies/aggregator');

const VALID = ['MEAN_REVERSION', 'MA_CROSSOVER', 'RSI', 'BOLLINGER', 'AGGREGATED'];

function isValid(key) { return VALID.includes(String(key || '').toUpperCase()); }

// Normalize a single-strategy result into the common envelope. Single strategies
// return { signal, confidence, reason, <indicator fields> }; we surface the
// common indicator fields so callers can persist them uniformly.
function _norm(res, strategyKey) {
  return {
    signal:       res.signal || 'HOLD',
    confidence:   Number(res.confidence) || 0,
    score:        res.score ?? null,
    strategy:     strategyKey,
    currentPrice: res.currentPrice ?? null,
    reason:       res.reason ?? null,
    components:   null,
    regime:       null,
    // indicator passthrough (whichever the strategy computed)
    zScore:   res.zScore   ?? null,
    rsiValue: res.rsiValue ?? res.rsi ?? null,
    maFast:   res.maFast   ?? null,
    maSlow:   res.maSlow   ?? null,
    bbUpper:  res.bbUpper  ?? null,
    bbLower:  res.bbLower  ?? null,
  };
}

/**
 * Evaluate a strategy on a close-price series. THE canonical signal decision.
 *
 * @param {string}   strategyKey  MEAN_REVERSION | MA_CROSSOVER | RSI | BOLLINGER | AGGREGATED
 * @param {number[]} closes       ascending close prices
 * @param {object}   opts
 *   @param {string}  opts.method           aggregator method ('weighted'|'majority')
 *   @param {string}  opts.symbol           enables stateful per-symbol regime (AGGREGATED)
 *   @param {boolean} opts.useRegime        regime-aware weights (AGGREGATED, default true)
 *   @param {object}  opts.overrideWeights  explicit weights (AGGREGATED; used by backtest loop)
 *   @param {string}  opts.bbMode           bollinger mode ('mean_reversion'|'breakout')
 * @returns {{signal, confidence, score, strategy, components, regime, ...indicators}}
 */
function evaluate(strategyKey, closes, opts = {}) {
  const key = String(strategyKey || 'AGGREGATED').toUpperCase();

  switch (key) {
    case 'MEAN_REVERSION': return _norm(meanReversion.generateSignal(closes), key);
    case 'MA_CROSSOVER':   return _norm(maCrossover.generateSignal(closes), key);
    case 'RSI':            return _norm(rsiStrategy.generateSignal(closes), key);
    case 'BOLLINGER':      return _norm(bollinger.generateSignal(closes, { mode: opts.bbMode || 'mean_reversion' }), key);
    case 'AGGREGATED':
    default: {
      // Forward only the options aggregator understands. aggregator itself picks
      // the right regime path: overrideWeights (explicit) > symbol (stateful) >
      // stateless > default weights.
      const aopts = { method: opts.method || 'weighted' };
      if (opts.overrideWeights) aopts.overrideWeights = opts.overrideWeights;
      if (opts.symbol)          aopts.symbol          = opts.symbol;
      if (opts.useRegime !== undefined) aopts.useRegime = opts.useRegime;
      return aggregator.aggregate(closes, aopts);
    }
  }
}

// Passthrough so callers don't need a separate aggregator import.
function describeWeights() { return aggregator.describeWeights(); }

module.exports = { evaluate, isValid, VALID, describeWeights };
