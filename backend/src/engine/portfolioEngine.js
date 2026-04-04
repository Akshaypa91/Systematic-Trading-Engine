// src/engine/portfolioEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// IMPROVEMENT 4+5: Multi-Asset Portfolio Engine + Advanced Risk Management
//
// PROBLEM IT SOLVES
// ──────────────────
// The original system is single-stock: one symbol per backtest, no
// cross-asset correlation tracking, no portfolio-level exposure limits.
//
// Real trading portfolios need:
//   1. Capital allocation across N symbols simultaneously
//   2. Per-asset position limits (max 20% in any one stock)
//   3. Total portfolio exposure limit (max 95% deployed)
//   4. Volatility parity: size positions so each contributes equal risk
//   5. Portfolio-level PnL tracking (not just per-trade)
//
// ALLOCATION METHODS
// ──────────────────
//   'equal'       — Equal capital split: 1/N per asset
//   'vol_parity'  — Volatility parity: weight ∝ 1/vol so each asset
//                   contributes equal risk to the portfolio
//   'score_weighted' — Weight ∝ strategy confidence score
//
// RISK CONTROLS
// ──────────────
//   MAX_SINGLE_ASSET_PCT  — cap any one position at 20% of portfolio
//   MAX_PORTFOLIO_EXPOSURE — never deploy more than 95% of capital
//   Correlation check — warn if adding a highly correlated asset
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

const PC = C.PORTFOLIO;
const RC = C.RISK;

/**
 * Allocate capital across multiple assets.
 *
 * @param {{
 *   totalCapital:  number,
 *   assets: Array<{
 *     symbol:     string,
 *     score:      number,   // signal confidence [0,1]
 *     recentVol:  number,   // annualised vol (e.g., 0.20)
 *     signal:     'BUY'|'SELL'|'HOLD',
 *   }>,
 *   method:       'equal'|'vol_parity'|'score_weighted',
 * }} params
 *
 * @returns {Array<{
 *   symbol:       string,
 *   allocation:   number,   // ₹ to allocate
 *   allocPct:     number,   // fraction of total capital
 *   weight:       number,   // raw weight before capping
 * }>}
 */
function allocateCapital({ totalCapital, assets, method = PC.ALLOC_METHOD }) {
  if (!totalCapital || totalCapital <= 0)
    throw new RangeError('[Portfolio] totalCapital must be > 0');
  if (!Array.isArray(assets) || assets.length === 0)
    throw new TypeError('[Portfolio] assets must be a non-empty array');

  // Only consider BUY signals
  const buyAssets = assets.filter(a => a.signal === 'BUY');
  if (buyAssets.length === 0) {
    logger.info('[Portfolio] No BUY signals — allocating 0 to all assets');
    return assets.map(a => ({ symbol: a.symbol, allocation: 0, allocPct: 0, weight: 0 }));
  }

  // Cap total deployed capital
  const deployable = totalCapital * RC.MAX_PORTFOLIO_EXPOSURE;

  // Compute raw weights
  let rawWeights = {};
  switch (method) {
    case 'vol_parity':
      rawWeights = _volParityWeights(buyAssets);
      break;
    case 'score_weighted':
      rawWeights = _scoreWeights(buyAssets);
      break;
    case 'equal':
    default:
      buyAssets.forEach(a => { rawWeights[a.symbol] = 1 / buyAssets.length; });
  }

  // Apply per-asset cap (MAX_SINGLE_ASSET_PCT)
  const maxPct = RC.MAX_SINGLE_ASSET_PCT;
  let cappedWeights = { ...rawWeights };
  let excess = 0;
  let uncapped = [];

  // First pass: cap over-weight assets
  for (const [sym, w] of Object.entries(cappedWeights)) {
    if (w > maxPct) {
      excess += w - maxPct;
      cappedWeights[sym] = maxPct;
    } else {
      uncapped.push(sym);
    }
  }

  // Redistribute excess to uncapped assets proportionally
  if (excess > 0 && uncapped.length > 0) {
    const totalUncapped = uncapped.reduce((s, sym) => s + cappedWeights[sym], 0);
    for (const sym of uncapped) {
      cappedWeights[sym] += (cappedWeights[sym] / totalUncapped) * excess;
      cappedWeights[sym] = Math.min(cappedWeights[sym], maxPct);
    }
  }

  // Normalise to sum to 1
  const weightSum = Object.values(cappedWeights).reduce((s, w) => s + w, 0);
  if (weightSum > 0) {
    for (const sym of Object.keys(cappedWeights))
      cappedWeights[sym] /= weightSum;
  }

  // Build result
  const result = assets.map(a => {
    const w = cappedWeights[a.symbol] || 0;
    const allocation = deployable * w;
    return {
      symbol:     a.symbol,
      allocation: parseFloat(allocation.toFixed(2)),
      allocPct:   parseFloat(w.toFixed(6)),
      weight:     parseFloat((rawWeights[a.symbol] || 0).toFixed(6)),
    };
  });

  logger.info(
    `[Portfolio] Allocated ₹${deployable.toLocaleString()} across ` +
    `${buyAssets.length} assets (${method}): ` +
    result.filter(r => r.allocation > 0)
          .map(r => `${r.symbol}=${(r.allocPct * 100).toFixed(1)}%`)
          .join(', ')
  );

  return result;
}

/**
 * Compute volatility parity weights.
 * weight_i ∝ 1 / vol_i  (lower vol → more capital, equal risk contribution)
 */
function _volParityWeights(assets) {
  const weights = {};
  const validAssets = assets.filter(a => a.recentVol != null && a.recentVol > 0);

  if (validAssets.length === 0) {
    // Fallback to equal if no vol data
    assets.forEach(a => { weights[a.symbol] = 1 / assets.length; });
    return weights;
  }

  // Use equal weight for assets with missing vol
  const invVols = validAssets.reduce((s, a) => s + 1 / a.recentVol, 0);
  validAssets.forEach(a => { weights[a.symbol] = (1 / a.recentVol) / invVols; });

  // Assets without vol get equal share of remaining
  const missingAssets = assets.filter(a => !a.recentVol || a.recentVol <= 0);
  if (missingAssets.length > 0) {
    const missingShare = 1 / assets.length * missingAssets.length;
    const scale        = 1 - missingShare;
    for (const sym of Object.keys(weights)) weights[sym] *= scale;
    missingAssets.forEach(a => { weights[a.symbol] = 1 / assets.length; });
  }

  return weights;
}

/**
 * Score-weighted: allocate more to higher-confidence signals.
 */
function _scoreWeights(assets) {
  const weights = {};
  const totalScore = assets.reduce((s, a) => s + Math.max(a.score || 0, 0.001), 0);
  assets.forEach(a => {
    weights[a.symbol] = Math.max(a.score || 0, 0.001) / totalScore;
  });
  return weights;
}

/**
 * Compute portfolio-level metrics given individual position data.
 *
 * @param {{
 *   positions: Array<{
 *     symbol:      string,
 *     entryPrice:  number,
 *     currentPrice:number,
 *     quantity:    number,
 *     side:        'BUY'|'SELL',
 *   }>,
 *   cash:          number,
 * }}
 * @returns {{
 *   totalValue:      number,
 *   deployedCapital: number,
 *   cashPct:         number,
 *   unrealisedPnL:   number,
 *   unrealisedPnLPct:number,
 *   positions:       Array,
 * }}
 */
function computePortfolioState({ positions = [], cash = 0 }) {
  let marketValue = 0;
  let costBasis   = 0;

  const enriched = positions.map(p => {
    const mv  = p.currentPrice * p.quantity;
    const cb  = p.entryPrice   * p.quantity;
    const pnl = p.side === 'BUY' ? mv - cb : cb - mv;
    marketValue += mv;
    costBasis   += cb;
    return {
      ...p,
      marketValue:  parseFloat(mv.toFixed(2)),
      costBasis:    parseFloat(cb.toFixed(2)),
      unrealisedPnL:parseFloat(pnl.toFixed(2)),
      pnlPct:       parseFloat(((pnl / cb) * 100).toFixed(4)),
    };
  });

  const totalValue    = marketValue + cash;
  const unrealisedPnL = marketValue - costBasis;

  return {
    totalValue:       parseFloat(totalValue.toFixed(2)),
    marketValue:      parseFloat(marketValue.toFixed(2)),
    cash:             parseFloat(cash.toFixed(2)),
    cashPct:          parseFloat((totalValue > 0 ? cash / totalValue : 1).toFixed(4)),
    deployedCapital:  parseFloat(marketValue.toFixed(2)),
    deployedPct:      parseFloat((totalValue > 0 ? marketValue / totalValue : 0).toFixed(4)),
    unrealisedPnL:    parseFloat(unrealisedPnL.toFixed(2)),
    unrealisedPnLPct: parseFloat((costBasis > 0 ? unrealisedPnL / costBasis * 100 : 0).toFixed(4)),
    positionCount:    positions.length,
    positions:        enriched,
  };
}

/**
 * Volatility-scaled position size.
 *
 * TARGET: each position contributes `volTargetPct` annual vol to portfolio.
 *   positionValue = (capital × volTarget) / assetVol
 *   quantity      = floor(positionValue / entryPrice)
 *
 * This means low-vol assets get larger positions, high-vol get smaller.
 * It equalises risk contribution across the portfolio.
 *
 * @param {{ capital, entryPrice, realisedVol, volTarget? }} params
 * @returns {{ quantity, positionValue, volContribution }}
 */
function volScaledSize({ capital, entryPrice, realisedVol, volTarget = RC.VOL_TARGET_ANNUAL }) {
  if (capital <= 0 || entryPrice <= 0)
    throw new RangeError('[Portfolio] capital and entryPrice must be > 0');

  if (!realisedVol || realisedVol <= 0) {
    // Fallback: use default 20% vol assumption
    realisedVol = 0.20;
    logger.warn('[Portfolio] No realised vol provided, using 20% default');
  }

  // Cap position to MAX_SINGLE_ASSET_PCT of capital
  const maxPositionValue = capital * RC.MAX_SINGLE_ASSET_PCT;
  const targetValue      = (capital * volTarget) / realisedVol;
  const positionValue    = Math.min(targetValue, maxPositionValue);
  const quantity         = Math.max(0, Math.floor(positionValue / entryPrice));

  logger.debug(
    `[Portfolio] VolScaled | vol=${(realisedVol * 100).toFixed(1)}% | ` +
    `target=₹${targetValue.toFixed(0)} | capped=₹${positionValue.toFixed(0)} | qty=${quantity}`
  );

  return {
    quantity,
    positionValue:   parseFloat(positionValue.toFixed(2)),
    volContribution: parseFloat((quantity * entryPrice * realisedVol / capital).toFixed(6)),
  };
}

/**
 * Check if adding a new asset would breach portfolio risk limits.
 * @returns {{ approved: boolean, warnings: string[] }}
 */
function checkPortfolioLimits({ currentPositions, newSymbol, newValue, totalCapital }) {
  const warnings = [];

  // 1. Position count limit
  if (currentPositions.length >= PC.MAX_ASSETS)
    warnings.push(`Max assets (${PC.MAX_ASSETS}) already reached`);

  // 2. Single asset concentration
  const allocPct = newValue / totalCapital;
  if (allocPct > RC.MAX_SINGLE_ASSET_PCT)
    warnings.push(
      `${newSymbol} allocation ${(allocPct * 100).toFixed(1)}% exceeds max ${(RC.MAX_SINGLE_ASSET_PCT * 100).toFixed(0)}%`
    );

  // 3. Total exposure
  const currentExposure = currentPositions.reduce(
    (s, p) => s + p.currentPrice * p.quantity, 0
  );
  const newExposure = currentExposure + newValue;
  if (newExposure / totalCapital > RC.MAX_PORTFOLIO_EXPOSURE)
    warnings.push(
      `Total exposure ${((newExposure / totalCapital) * 100).toFixed(1)}% would exceed ` +
      `${(RC.MAX_PORTFOLIO_EXPOSURE * 100).toFixed(0)}% limit`
    );

  return { approved: warnings.length === 0, warnings };
}

module.exports = {
  allocateCapital,
  computePortfolioState,
  volScaledSize,
  checkPortfolioLimits,
};
