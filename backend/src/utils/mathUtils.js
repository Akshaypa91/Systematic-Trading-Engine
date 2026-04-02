// src/utils/mathUtils.js
// Pure mathematical / statistical helpers.
// All functions validate inputs — never silently produce NaN or Infinity.

'use strict';

// ── Input validation ──────────────────────────────────────────────────────────

function _requireFiniteArray(arr, name, minLen = 1) {
  if (!Array.isArray(arr))
    throw new TypeError(`${name}: expected array, got ${typeof arr}`);
  if (arr.length < minLen)
    throw new RangeError(`${name}: need ≥${minLen} elements, got ${arr.length}`);
  if (arr.some(v => typeof v !== 'number' || !isFinite(v)))
    throw new TypeError(`${name}: all elements must be finite numbers`);
}

// ── Descriptive statistics ────────────────────────────────────────────────────

/** Arithmetic mean.  μ = (1/n) Σ xᵢ */
function mean(arr) {
  _requireFiniteArray(arr, 'mean');
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Population variance.  σ² = (1/n) Σ (xᵢ − μ)² */
function variance(arr) {
  _requireFiniteArray(arr, 'variance', 2);
  const μ = mean(arr);
  return arr.reduce((s, v) => s + (v - μ) ** 2, 0) / arr.length;
}

/** Population standard deviation.  σ = √σ² */
function stdDev(arr) {
  return Math.sqrt(variance(arr));
}

/**
 * Z-score of value x relative to array arr.
 *   Z = (x − μ) / σ
 * Returns null when σ = 0 (degenerate).
 */
function zScore(x, arr) {
  if (typeof x !== 'number' || !isFinite(x))
    throw new TypeError('zScore: x must be a finite number');
  _requireFiniteArray(arr, 'zScore', 2);
  const σ = stdDev(arr);
  return σ === 0 ? null : (x - mean(arr)) / σ;
}

/** Z-score of the last element over the full window. Returns null if < 2 elements. */
function rollingZScore(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  return zScore(arr[arr.length - 1], arr);
}

// ── Moving averages ───────────────────────────────────────────────────────────

/** Simple Moving Average over the last `period` values. Returns null if insufficient data. */
function sma(arr, period) {
  if (!Array.isArray(arr) || !Number.isInteger(period) || period < 1) return null;
  if (arr.length < period) return null;
  const window = arr.slice(-period);
  if (window.some(v => typeof v !== 'number' || !isFinite(v))) return null;
  return window.reduce((s, v) => s + v, 0) / period;
}

/**
 * Exponential Moving Average.
 *   EMAₜ = priceₜ × k + EMAₜ₋₁ × (1 − k),   k = 2/(period+1)
 * Seed: EMA₀ = arr[0].  Returns null if insufficient data.
 */
function ema(arr, period) {
  if (!Array.isArray(arr) || !Number.isInteger(period) || period < 1) return null;
  if (arr.length < period) return null;
  if (arr.some(v => typeof v !== 'number' || !isFinite(v))) return null;
  const k = 2 / (period + 1);
  let val = arr[0];
  for (let i = 1; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
  return val;
}

// ── Momentum indicators ───────────────────────────────────────────────────────

/**
 * Wilder RSI.
 *   Seed: AvgGain = mean(gains over first `period` changes)
 *   Smooth: AvgGainₜ = (AvgGainₜ₋₁ × (n−1) + gainₜ) / n
 *   RS = AvgGain / AvgLoss,   RSI = 100 − 100/(1+RS)
 * Returns null if prices < period+1.  Returns 100 if AvgLoss = 0.
 */
function rsi(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    if (!isFinite(delta)) return null;
    changes.push(delta);
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else                avgLoss -= changes[i];
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0))  / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Rate of Change over `period` bars.
 *   ROC = (Pₜ − Pₜ₋ₙ) / Pₜ₋ₙ
 * Returns null if insufficient data or Pₜ₋ₙ ≤ 0.
 */
function roc(prices, period) {
  if (!Array.isArray(prices) || !Number.isInteger(period) || period < 1) return null;
  if (prices.length < period + 1) return null;
  const prev = prices[prices.length - 1 - period];
  if (!isFinite(prev) || prev <= 0) return null;
  return (prices[prices.length - 1] - prev) / prev;
}

// ── Returns ───────────────────────────────────────────────────────────────────

/**
 * Daily log returns.  rᵢ = ln(Pᵢ / Pᵢ₋₁)
 * Skips any pair where Pᵢ₋₁ ≤ 0 or values are non-finite.
 */
function logReturns(prices) {
  if (!Array.isArray(prices)) return [];
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    if (isFinite(prices[i]) && isFinite(prices[i - 1]) && prices[i - 1] > 0)
      out.push(Math.log(prices[i] / prices[i - 1]));
  }
  return out;
}

/** Daily simple returns.  rᵢ = (Pᵢ − Pᵢ₋₁) / Pᵢ₋₁ */
function simpleReturns(prices) {
  if (!Array.isArray(prices)) return [];
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    if (isFinite(prices[i]) && isFinite(prices[i - 1]) && prices[i - 1] > 0)
      out.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return out;
}

// ── Risk metrics ──────────────────────────────────────────────────────────────

/**
 * Annualised Sharpe Ratio.
 *   Sharpe = (Ē[excess_r] / σ(excess_r)) × √tradingDays
 * Returns null if < 2 returns or σ = 0.
 */
function sharpeRatio(returns, riskFreeRate = 0.065, tradingDays = 252) {
  if (!Array.isArray(returns)) return null;
  const finite = returns.filter(r => isFinite(r));
  if (finite.length < 2) return null;
  const dailyRf = riskFreeRate / tradingDays;
  const excess  = finite.map(r => r - dailyRf);
  const μ = excess.reduce((s, v) => s + v, 0) / excess.length;
  const σ = Math.sqrt(excess.reduce((s, v) => s + (v - μ) ** 2, 0) / excess.length);
  if (σ === 0) return null;
  return (μ / σ) * Math.sqrt(tradingDays);
}

/**
 * Sortino Ratio — penalises only downside volatility.
 *   σ_down = std-dev of returns < riskFreeRate/tradingDays
 */
function sortinoRatio(returns, riskFreeRate = 0.065, tradingDays = 252) {
  if (!Array.isArray(returns)) return null;
  const finite  = returns.filter(r => isFinite(r));
  if (finite.length < 2) return null;
  const dailyRf = riskFreeRate / tradingDays;
  const μ       = finite.reduce((s, v) => s + v, 0) / finite.length;
  const downDev = finite.filter(r => r < dailyRf).map(r => (r - dailyRf) ** 2);
  if (downDev.length === 0) return null;
  const σDown = Math.sqrt(downDev.reduce((s, v) => s + v, 0) / downDev.length);
  if (σDown === 0) return null;
  return ((μ - dailyRf) / σDown) * Math.sqrt(tradingDays);
}

/**
 * Maximum Drawdown.
 *   MDD = max over all t of (peak_t − trough_t) / peak_t
 * Returns { maxDrawdown: 0, ... } for degenerate input.
 */
function maxDrawdown(equityCurve) {
  if (!Array.isArray(equityCurve) || equityCurve.length < 2)
    return { maxDrawdown: 0, peakIdx: 0, troughIdx: 0 };
  let peak = equityCurve[0], peakIdx = 0;
  let mdd = 0, mddPeak = 0, mddTrough = 0;
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) { peak = equityCurve[i]; peakIdx = i; }
    const dd = peak > 0 ? (peak - equityCurve[i]) / peak : 0;
    if (dd > mdd) { mdd = dd; mddPeak = peakIdx; mddTrough = i; }
  }
  return { maxDrawdown: mdd, peakIdx: mddPeak, troughIdx: mddTrough };
}

/** Annualised volatility = σ(logReturns) × √tradingDays */
function annualisedVol(prices, tradingDays = 252) {
  const r = logReturns(prices);
  if (r.length < 2) return null;
  const μ  = r.reduce((s, v) => s + v, 0) / r.length;
  const σ2 = r.reduce((s, v) => s + (v - μ) ** 2, 0) / r.length;
  return Math.sqrt(σ2) * Math.sqrt(tradingDays);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Clamp value to [lo, hi]. */
function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Normalise value to [0, 1] given observed min/max.
 * Returns 0.5 on degenerate (min === max) input.
 */
function normalise(value, minVal, maxVal) {
  if (maxVal === minVal) return 0.5;
  return clamp((value - minVal) / (maxVal - minVal), 0, 1);
}

/** Linear interpolation: lerp(a, b, 0) = a, lerp(a, b, 1) = b */
function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

module.exports = {
  mean, variance, stdDev, zScore, rollingZScore,
  sma, ema,
  rsi, roc,
  logReturns, simpleReturns,
  sharpeRatio, sortinoRatio, maxDrawdown, annualisedVol,
  clamp, normalise, lerp,
};
