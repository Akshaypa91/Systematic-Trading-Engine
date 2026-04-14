// src/utils/pnlCalculator.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure PnL calculation functions — no side effects, no hardcoded values.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

/**
 * Calculate unrealized PnL for a single position.
 * @param {number} entryPrice  - Average entry price
 * @param {number} currentPrice - Latest market price
 * @param {number} qty         - Number of shares held
 * @returns {{ pnl, pnlPct, currentValue, costBasis }}
 */
function calcPositionPnL(entryPrice, currentPrice, qty) {
  const costBasis    = parseFloat((entryPrice * qty).toFixed(2));
  const currentValue = parseFloat((currentPrice * qty).toFixed(2));
  const pnl          = parseFloat((currentValue - costBasis).toFixed(2));
  const pnlPct       = costBasis > 0
    ? parseFloat(((pnl / costBasis) * 100).toFixed(2))
    : 0;

  return { pnl, pnlPct, currentValue, costBasis };
}

/**
 * Calculate realized PnL from trade history.
 * @param {Array} trades - Array of trade objects with { action, pnl }
 * @returns {number} total realized PnL
 */
function calcRealizedPnL(trades) {
  return parseFloat(
    trades
      .filter(t => t.action === 'SELL' && t.pnl != null)
      .reduce((sum, t) => sum + t.pnl, 0)
      .toFixed(2)
  );
}

/**
 * Enrich positions map with live prices and PnL data.
 * @param {Object} positions  - { [symbol]: { qty, entryPrice, value } }
 * @param {Map|Object} priceMap - symbol → currentPrice lookup
 * @returns {Object} enriched positions with pnl fields
 */
function enrichPositionsWithPnL(positions, priceMap) {
  const enriched = {};

  for (const [symbol, pos] of Object.entries(positions)) {
    const currentPrice = (priceMap instanceof Map)
      ? (priceMap.get(symbol) ?? pos.entryPrice)
      : (priceMap[symbol]    ?? pos.entryPrice);

    const { pnl, pnlPct, currentValue, costBasis } = calcPositionPnL(
      pos.entryPrice,
      currentPrice,
      pos.qty
    );

    enriched[symbol] = {
      ...pos,
      currentPrice: parseFloat(Number(currentPrice).toFixed(2)),
      pnl,
      pnlPct,
      currentValue,
      costBasis,
    };
  }

  return enriched;
}

/**
 * Calculate total portfolio PnL summary.
 * @param {Object} enrichedPositions - output of enrichPositionsWithPnL
 * @param {number} capital           - available cash
 * @param {number} initialCapital    - starting capital
 * @param {Array}  trades            - trade history for realized PnL
 * @returns {{ unrealizedPnL, realizedPnL, totalPnL, totalPnLPct,
 *             totalValue, positionsValue }}
 */
function calcPortfolioSummary(enrichedPositions, capital, initialCapital, trades) {
  const posEntries    = Object.values(enrichedPositions);
  const positionsValue = parseFloat(
    posEntries.reduce((s, p) => s + (p.currentValue ?? p.costBasis), 0).toFixed(2)
  );

  const unrealizedPnL = parseFloat(
    posEntries.reduce((s, p) => s + (p.pnl ?? 0), 0).toFixed(2)
  );

  const realizedPnL   = calcRealizedPnL(trades);
  const totalPnL      = parseFloat((unrealizedPnL + realizedPnL).toFixed(2));
  const totalValue    = parseFloat((capital + positionsValue).toFixed(2));

  const totalPnLPct   = initialCapital > 0
    ? parseFloat(((totalPnL / initialCapital) * 100).toFixed(2))
    : 0;

  // Find biggest gainer / loser by PnL %
  let biggestGainer = null;
  let biggestLoser  = null;

  for (const [symbol, pos] of Object.entries(enrichedPositions)) {
    if (!biggestGainer || pos.pnlPct > biggestGainer.pnlPct) {
      biggestGainer = { symbol, pnlPct: pos.pnlPct };
    }
    if (!biggestLoser || pos.pnlPct < biggestLoser.pnlPct) {
      biggestLoser = { symbol, pnlPct: pos.pnlPct };
    }
  }

  return {
    unrealizedPnL,
    realizedPnL,
    totalPnL,
    totalPnLPct,
    totalValue,
    positionsValue,
    biggestGainer,
    biggestLoser,
  };
}

module.exports = {
  calcPositionPnL,
  calcRealizedPnL,
  enrichPositionsWithPnL,
  calcPortfolioSummary,
};
