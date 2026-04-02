// src/strategies/bollingerBands.js
// ─────────────────────────────────────────────────────────────────────────────
// Bollinger Bands Strategy
//
// MATHEMATICAL BASIS  (John Bollinger, 1983)
// ───────────────────────────────────────────
// Middle Band (MB):  SMA_N(t)
// Upper Band  (UB):  MB + k × σ_N(t)
// Lower Band  (LB):  MB - k × σ_N(t)
//
// where σ_N = rolling population std-dev over N periods, k = 2 (default)
//
// SIGNALS
// ───────
// 1. Mean Reversion (default mode):
//    Price ≤ LB → BUY  (price has stretched too far below mean)
//    Price ≥ UB → SELL (price has stretched too far above mean)
//
// 2. Breakout mode (trend-following):
//    Price closes above UB with expanding bands → BUY  (momentum breakout)
//    Price closes below LB with expanding bands → SELL (breakdown)
//
// BANDWIDTH  (measures band expansion / contraction)
//    BW = (UB - LB) / MB × 100
//    High BW = high volatility, bands expanding
//    Low  BW = Squeeze — low volatility, potential breakout ahead
//
// %B INDICATOR  (normalised position within bands)
//    %B = (Price - LB) / (UB - LB)
//    %B = 0 → price at lower band
//    %B = 1 → price at upper band
//    %B = 0.5 → price at middle band
//
// CONFIDENCE
// ──────────
//    For BUY:  conf = clamp((1 - %B) / 0.5, 0, 1)  — deepest below LB = 1.0
//    For SELL: conf = clamp((%B - 1) / 0.5 + 1, 0, 1) — furthest above UB = 1.0
//    Simplified: conf = clamp(|%B - 0.5| / 0.5, 0, 1)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const logger = require('../config/logger');

const DEFAULTS = {
  PERIOD:    20,
  K:          2,       // Number of std-devs for band width
  MODE:  'mean_reversion',  // 'mean_reversion' | 'breakout'
};

/**
 * Generate Bollinger Bands signal.
 *
 * @param {number[]} prices  - Close prices, ascending. Min: PERIOD elements.
 * @param {Object}   opts    - { period, k, mode }
 * @returns {{
 *   signal:      'BUY' | 'SELL' | 'HOLD',
 *   confidence:  number,
 *   upperBand:   number,
 *   middleBand:  number,
 *   lowerBand:   number,
 *   bandwidth:   number,
 *   percentB:    number,
 *   squeeze:     boolean,
 *   currentPrice:number,
 *   reason:      string,
 * }}
 */
function generateSignal(prices, opts = {}) {
  const period = opts.period || DEFAULTS.PERIOD;
  const k      = opts.k      || DEFAULTS.K;
  const mode   = opts.mode   || DEFAULTS.MODE;

  if (!Array.isArray(prices) || prices.length < period) {
    return _emptyResult(prices?.at(-1) ?? null,
      `Insufficient data (need ${period}, got ${prices?.length ?? 0})`);
  }

  const window      = prices.slice(-period);
  const currentPrice = prices[prices.length - 1];
  const mb          = mu.mean(window);
  const std         = mu.stdDev(window);

  const ub = mb + k * std;
  const lb = mb - k * std;

  // %B: 0 = at lower band, 1 = at upper band
  const bandwidth = ub - lb;
  const percentB  = bandwidth > 0 ? (currentPrice - lb) / bandwidth : 0.5;

  // Bandwidth percentage: (UB-LB) / MB × 100
  const bw = mb > 0 ? ((ub - lb) / mb) * 100 : 0;

  // Squeeze: bandwidth < 5% of middle band (low-volatility compression)
  const squeeze = bw < 5;

  // Previous window for breakout detection
  const prevWindow  = prices.slice(-period - 1, -1);
  const prevBw      = prevWindow.length === period
    ? (() => {
        const pm  = mu.mean(prevWindow);
        const ps  = mu.stdDev(prevWindow);
        return pm > 0 ? ((pm + k * ps - (pm - k * ps)) / pm) * 100 : 0;
      })()
    : bw;

  const bandsExpanding = bw > prevBw;

  let signal, confidence, reason;

  if (mode === 'breakout') {
    // Breakout: price outside band AND bands expanding
    if (currentPrice > ub && bandsExpanding) {
      signal    = 'BUY';
      reason    = `Breakout above upper band ₹${ub.toFixed(2)} with expanding bandwidth ${bw.toFixed(2)}%`;
    } else if (currentPrice < lb && bandsExpanding) {
      signal    = 'SELL';
      reason    = `Breakdown below lower band ₹${lb.toFixed(2)} with expanding bandwidth ${bw.toFixed(2)}%`;
    } else if (squeeze) {
      signal    = 'HOLD';
      reason    = `Bollinger Squeeze — bandwidth ${bw.toFixed(2)}% is compressed, awaiting breakout`;
    } else {
      signal    = 'HOLD';
      reason    = `Price inside bands, bands ${bandsExpanding ? 'expanding' : 'contracting'}`;
    }
  } else {
    // Mean reversion (default): price at/outside band → revert
    if (currentPrice <= lb) {
      signal = 'BUY';
      reason = `Price ₹${currentPrice.toFixed(2)} at/below lower band ₹${lb.toFixed(2)} (%B=${percentB.toFixed(3)})`;
    } else if (currentPrice >= ub) {
      signal = 'SELL';
      reason = `Price ₹${currentPrice.toFixed(2)} at/above upper band ₹${ub.toFixed(2)} (%B=${percentB.toFixed(3)})`;
    } else {
      signal = 'HOLD';
      reason = `Price within bands — %B=${percentB.toFixed(3)}, BW=${bw.toFixed(2)}%`;
    }
  }

  // Confidence: distance of %B from 0.5 normalised to [0,1]
  confidence = mu.clamp(Math.abs(percentB - 0.5) / 0.5, 0, 1);

  logger.debug(
    `[BB] ${signal} | price=${currentPrice.toFixed(2)} | ` +
    `LB=${lb.toFixed(2)} MB=${mb.toFixed(2)} UB=${ub.toFixed(2)} | ` +
    `%B=${percentB.toFixed(3)} BW=${bw.toFixed(2)}% | conf=${confidence.toFixed(3)}`
  );

  return {
    signal,
    confidence: parseFloat(confidence.toFixed(4)),
    upperBand:  parseFloat(ub.toFixed(4)),
    middleBand: parseFloat(mb.toFixed(4)),
    lowerBand:  parseFloat(lb.toFixed(4)),
    bandwidth:  parseFloat(bw.toFixed(4)),
    percentB:   parseFloat(percentB.toFixed(6)),
    squeeze,
    currentPrice,
    reason,
  };
}

function _emptyResult(currentPrice, reason) {
  return {
    signal: 'HOLD', confidence: 0,
    upperBand: null, middleBand: null, lowerBand: null,
    bandwidth: null, percentB: null, squeeze: false,
    currentPrice, reason,
  };
}

function describe() {
  return {
    name: 'Bollinger Bands (20, 2σ)',
    parameters: DEFAULTS,
    description: 'Generates BUY when price touches lower band (mean-reversion mode) or breaks above upper band (breakout mode). %B and bandwidth give regime context.',
    assumedMarketRegime: 'Mean-reversion mode: range-bound. Breakout mode: trending.',
    indicators: ['%B', 'Bandwidth', 'Squeeze'],
    limitations: [
      'Mean-reversion fails in strong trends — use breakout mode',
      'Squeeze has no directional bias on its own',
      'Sensitive to period and k parameters',
    ],
  };
}

module.exports = { generateSignal, describe, DEFAULTS };
