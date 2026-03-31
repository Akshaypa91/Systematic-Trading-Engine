// src/utils/mathUtils.js
// Pure mathematical / statistical helpers — no side effects, fully testable.

'use strict';

const math = require('mathjs');

/**
 * Arithmetic mean of an array.
 * μ = (1/n) Σ xᵢ
 */
function mean(arr) {
  if (!arr || arr.length === 0) throw new Error('mean: empty array');
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Population variance.
 * σ² = (1/n) Σ (xᵢ - μ)²
 */
function variance(arr) {
  const μ = mean(arr);
  return arr.reduce((s, v) => s + (v - μ) ** 2, 0) / arr.length;
}

/**
 * Population standard deviation.
 * σ = √σ²
 */
function stdDev(arr) {
  return Math.sqrt(variance(arr));
}

/**
 * Z-score of value x relative to a distribution [arr].
 * Z = (x - μ) / σ
 * Returns null if σ is 0 (all values identical).
 */
function zScore(x, arr) {
  const μ = mean(arr);
  const σ = stdDev(arr);
  if (σ === 0) return null;
  return (x - μ) / σ;
}

/**
 * Z-score of the last element in arr, computed over the full window.
 * This is the primary measure for mean-reversion strategies.
 */
function rollingZScore(arr) {
  if (arr.length < 2) return null;
  return zScore(arr[arr.length - 1], arr);
}

/**
 * Simple Moving Average over the last `period` values.
 * Returns null when insufficient data.
 */
function sma(arr, period) {
  if (arr.length < period) return null;
  const window = arr.slice(arr.length - period);
  return mean(window);
}

/**
 * Exponential Moving Average.
 * EMA_t = price_t × k + EMA_{t-1} × (1 - k)   where k = 2 / (period + 1)
 * Seed: first EMA = first price.
 */
function ema(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    emaVal = arr[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

/**
 * RSI (Relative Strength Index) — Wilder's method.
 *
 * Steps:
 *   1. Compute daily changes: Δ = close_t - close_{t-1}
 *   2. Separate gains (U) and losses (D, absolute)
 *   3. Initial avg: avgU = mean(U[0..period]), avgD = mean(D[0..period])
 *   4. Smoothed (Wilder): avgU = (prevAvgU × (period-1) + currU) / period
 *   5. RS = avgU / avgD
 *   6. RSI = 100 - (100 / (1 + RS))
 *
 * Requires at least period+1 prices.
 */
function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Seed averages using first `period` changes (simple mean)
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else                avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Daily log returns: rᵢ = ln(close_t / close_{t-1})
 * Log returns are preferred in finance for their additive property and
 * approximate normality at daily frequency.
 */
function logReturns(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0) continue;
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return returns;
}

/**
 * Annualised Sharpe Ratio.
 *
 * Sharpe = (E[r] - r_f) / σ_r × √(tradingDays)
 *
 * @param {number[]} returns          - Daily returns (arithmetic, not log)
 * @param {number}   riskFreeRate     - Annualised, e.g. 0.065 for 6.5 %
 * @param {number}   tradingDaysPerYear - Default 252
 */
function sharpeRatio(returns, riskFreeRate = 0.065, tradingDaysPerYear = 252) {
  if (!returns || returns.length < 2) return null;
  const dailyRf = riskFreeRate / tradingDaysPerYear;
  const excessReturns = returns.map(r => r - dailyRf);
  const μ = mean(excessReturns);
  const σ = stdDev(excessReturns);
  if (σ === 0) return null;
  return (μ / σ) * Math.sqrt(tradingDaysPerYear);
}

/**
 * Maximum Drawdown.
 * MDD = max over time of (peak - trough) / peak
 *
 * @param {number[]} equityCurve - Array of portfolio values over time
 * @returns {{ maxDrawdown: number, peakIdx: number, troughIdx: number }}
 */
function maxDrawdown(equityCurve) {
  let peak = equityCurve[0];
  let peakIdx = 0;
  let mdd = 0;
  let mddPeak = 0, mddTrough = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      peakIdx = i;
    }
    const dd = (peak - equityCurve[i]) / peak;
    if (dd > mdd) {
      mdd = dd;
      mddPeak   = peakIdx;
      mddTrough = i;
    }
  }
  return { maxDrawdown: mdd, peakIdx: mddPeak, troughIdx: mddTrough };
}

/**
 * Clamp a value to [min, max].
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalise a value to [0, 1] given the observed min/max.
 * Returns 0.5 when min === max (degenerate case).
 */
function normalise(value, minVal, maxVal) {
  if (maxVal === minVal) return 0.5;
  return clamp((value - minVal) / (maxVal - minVal), 0, 1);
}

module.exports = {
  mean, variance, stdDev, zScore, rollingZScore,
  sma, ema, rsi, logReturns, sharpeRatio, maxDrawdown,
  clamp, normalise,
};
