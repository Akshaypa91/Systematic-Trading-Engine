// src/screener/correlationAnalysis.js
// ─────────────────────────────────────────────────────────────────────────────
// Pair Correlation & Sector Diversification Analysis
//
// MATHEMATICAL BASIS
// ──────────────────
// Pearson correlation coefficient between two return series A, B:
//
//   ρ(A,B) = Cov(A,B) / (σ_A × σ_B)
//
//   Cov(A,B) = (1/n) Σ (aᵢ - ā)(bᵢ - b̄)
//
// Range: [-1, +1]
//   +1  = perfect positive correlation (move together)
//    0  = uncorrelated (independent moves)
//   -1  = perfect negative correlation (hedge pair)
//
// APPLICATIONS
// ────────────
// 1. Portfolio diversification: prefer |ρ| < 0.5 between holdings
// 2. Pairs trading: find highly correlated pairs (|ρ| > 0.8), trade the spread
// 3. Risk concentration: flag portfolios with average pair correlation > 0.7
//
// ROLLING CORRELATION
// ────────────────────
// 60-day rolling window — more relevant than full-history correlation for
// detecting regime changes (correlation structure is non-stationary).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const dataStore = require('../data/dataStore');
const mu        = require('../utils/mathUtils');
const logger    = require('../config/logger');

/**
 * Compute Pearson correlation between two equal-length return series.
 *
 * @param {number[]} rA
 * @param {number[]} rB
 * @returns {number | null}
 */
function pearsonCorrelation(rA, rB) {
  const n = Math.min(rA.length, rB.length);
  if (n < 10) return null;

  const a = rA.slice(-n);
  const b = rB.slice(-n);

  const meanA = mu.mean(a);
  const meanB = mu.mean(b);

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov  += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? null : parseFloat((cov / denom).toFixed(6));
}

/**
 * Build a full correlation matrix for a set of symbols.
 * Uses daily log returns aligned by date.
 *
 * @param {string[]} symbols
 * @param {number}   lookback  - Days of history to use (default 60)
 * @returns {Promise<{
 *   symbols:    string[],
 *   matrix:     number[][],
 *   pairs:      Array<{ symbolA, symbolB, correlation, strength }>,
 *   avgCorrelation: number,
 *   diversificationScore: number,
 * }>}
 */
async function buildCorrelationMatrix(symbols, lookback = 60) {
  logger.info(`[Corr] Building ${symbols.length}×${symbols.length} matrix (${lookback}d lookback)`);

  // Fetch return series for all symbols in parallel
  const returnMap = new Map();
  await Promise.all(symbols.map(async (sym) => {
    try {
      const bars = await dataStore.getRecentPrices(sym, lookback + 5);
      if (bars && bars.length >= lookback) {
        const closes  = bars.slice(-(lookback + 1)).map(b => b.close);
        const returns = mu.logReturns(closes);
        returnMap.set(sym, returns);
      }
    } catch (err) {
      logger.warn(`[Corr] Skipping ${sym}: ${err.message}`);
    }
  }));

  const validSymbols = symbols.filter(s => returnMap.has(s));
  const n = validSymbols.length;

  if (n < 2) {
    throw new Error('Need at least 2 symbols with sufficient data for correlation matrix');
  }

  // Align return series to the same length (take the minimum)
  const minLen = Math.min(...validSymbols.map(s => returnMap.get(s).length));
  const aligned = new Map();
  for (const sym of validSymbols) {
    aligned.set(sym, returnMap.get(sym).slice(-minLen));
  }

  // Build n×n matrix
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  const pairs  = [];

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1.0;  // Self-correlation
    for (let j = i + 1; j < n; j++) {
      const rho = pearsonCorrelation(aligned.get(validSymbols[i]), aligned.get(validSymbols[j]));
      matrix[i][j] = rho ?? 0;
      matrix[j][i] = rho ?? 0;

      pairs.push({
        symbolA:     validSymbols[i],
        symbolB:     validSymbols[j],
        correlation: rho,
        strength:    classifyCorrelation(rho),
      });
    }
  }

  // Sort pairs by absolute correlation descending
  pairs.sort((a, b) => Math.abs(b.correlation ?? 0) - Math.abs(a.correlation ?? 0));

  // Average pairwise correlation (excluding self)
  const corrValues  = pairs.map(p => p.correlation).filter(r => r !== null);
  const avgCorr     = corrValues.length ? mu.mean(corrValues.map(Math.abs)) : 0;

  // Diversification score: 1 = perfectly uncorrelated, 0 = all identical
  const diversificationScore = parseFloat((1 - avgCorr).toFixed(4));

  return {
    symbols:   validSymbols,
    matrix,
    pairs:     pairs.slice(0, 50),   // Top 50 pairs by correlation strength
    avgCorrelation:      parseFloat(avgCorr.toFixed(4)),
    diversificationScore,
    lookbackDays: lookback,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Find the most correlated pairs — useful for pairs trading.
 *
 * @param {string[]} symbols
 * @param {number}   minCorrelation  - Minimum |ρ| to include (default 0.7)
 * @param {number}   lookback
 * @returns {Promise<Array>}
 */
async function findCorrelatedPairs(symbols, minCorrelation = 0.70, lookback = 60) {
  const { pairs } = await buildCorrelationMatrix(symbols, lookback);
  return pairs.filter(p => p.correlation !== null && Math.abs(p.correlation) >= minCorrelation);
}

/**
 * Compute the spread (log price ratio) between two correlated symbols.
 * Used for pairs trading mean-reversion on the spread.
 *
 * Spread = ln(P_A / P_B)
 * Z-score of spread → BUY A/SELL B when z < -2 (A cheap relative to B)
 *
 * @param {string} symbolA
 * @param {string} symbolB
 * @param {number} lookback
 */
async function analyseSpread(symbolA, symbolB, lookback = 60) {
  const [barsA, barsB] = await Promise.all([
    dataStore.getRecentPrices(symbolA, lookback),
    dataStore.getRecentPrices(symbolB, lookback),
  ]);

  if (!barsA || !barsB || barsA.length < 20 || barsB.length < 20) {
    throw new Error(`Insufficient data for spread analysis (${symbolA} vs ${symbolB})`);
  }

  // Align to the shorter series
  const len     = Math.min(barsA.length, barsB.length);
  const closesA = barsA.slice(-len).map(b => b.close);
  const closesB = barsB.slice(-len).map(b => b.close);

  // Log price spread: ln(A/B)
  const spread = closesA.map((a, i) => Math.log(a / closesB[i]));

  const spreadMean  = mu.mean(spread);
  const spreadStd   = mu.stdDev(spread);
  const currentZ    = spreadStd > 0
    ? (spread[spread.length - 1] - spreadMean) / spreadStd
    : 0;

  // Pearson correlation of returns
  const retA  = mu.logReturns(closesA);
  const retB  = mu.logReturns(closesB);
  const corr  = pearsonCorrelation(retA, retB);

  let signal, reason;
  if      (currentZ < -2) { signal = 'BUY_A_SELL_B';  reason = `Spread ${currentZ.toFixed(2)}σ below mean — ${symbolA} cheap vs ${symbolB}`; }
  else if (currentZ >  2) { signal = 'SELL_A_BUY_B'; reason = `Spread ${currentZ.toFixed(2)}σ above mean — ${symbolA} expensive vs ${symbolB}`; }
  else                    { signal = 'HOLD';           reason = `Spread ${currentZ.toFixed(2)}σ within ±2 band`; }

  return {
    symbolA, symbolB,
    correlation:   corr,
    spreadZScore:  parseFloat(currentZ.toFixed(4)),
    spreadMean:    parseFloat(spreadMean.toFixed(6)),
    spreadStd:     parseFloat(spreadStd.toFixed(6)),
    currentSpread: parseFloat(spread[spread.length - 1].toFixed(6)),
    signal, reason,
    priceRatio:    parseFloat((closesA.at(-1) / closesB.at(-1)).toFixed(4)),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyCorrelation(rho) {
  if (rho === null) return 'UNKNOWN';
  const abs = Math.abs(rho);
  if (abs >= 0.90) return rho > 0 ? 'VERY_HIGH_POSITIVE' : 'VERY_HIGH_NEGATIVE';
  if (abs >= 0.70) return rho > 0 ? 'HIGH_POSITIVE' : 'HIGH_NEGATIVE';
  if (abs >= 0.50) return rho > 0 ? 'MODERATE_POSITIVE' : 'MODERATE_NEGATIVE';
  if (abs >= 0.30) return rho > 0 ? 'LOW_POSITIVE' : 'LOW_NEGATIVE';
  return 'NEGLIGIBLE';
}

module.exports = {
  pearsonCorrelation,
  buildCorrelationMatrix,
  findCorrelatedPairs,
  analyseSpread,
};
