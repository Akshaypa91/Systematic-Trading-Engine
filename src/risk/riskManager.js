// src/risk/riskManager.js
// ─────────────────────────────────────────────────────────────────────────────
// Risk Management Engine
//
// CORE PRINCIPLES
// ───────────────
// 1. Never risk more than 1–2 % of capital on any single trade.
// 2. Never lose more than 5 % of capital in a single day.
// 3. Position size must account for both capital at risk and volatility.
//
// POSITION SIZING METHODS
// ───────────────────────
// A. Fixed Fractional (recommended default)
//    quantity = floor( (capital × riskPct) / (entryPrice × stopLossPct) )
//    → Risks exactly riskPct of capital, no matter the instrument.
//
// B. Kelly Criterion (aggressive, use with caution)
//    f* = (W × B - L) / B
//      W = win rate (e.g. 0.55)
//      B = average win / average loss ratio
//      L = 1 - W (loss rate)
//    quantity = floor( (capital × f* × safetyFactor) / entryPrice )
//
//    We apply a "half-Kelly" (safetyFactor=0.5) to reduce variance.
//    Full Kelly maximises long-run geometric growth but produces large drawdowns.
//
// STOP LOSS / TAKE PROFIT
// ───────────────────────
//    stopLoss   = entryPrice × (1 − stopLossPct)   for longs
//    takeProfit = entryPrice × (1 + takeProfitPct)  for longs
//    (reversed for shorts)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const C      = require('../config/constants');
const logger = require('../config/logger');

const R = C.RISK;

// ─── Daily Loss Tracker ───────────────────────────────────────────────────────
// In production this should be persisted to DB and reset at market open.
const dailyLossTracker = new Map();   // portfolioId → { date: string, loss: number }

/**
 * Record a realised loss for a portfolio. Called by the execution engine.
 * @param {string} portfolioId
 * @param {number} amount - Positive number = loss amount (₹)
 */
function recordDailyLoss(portfolioId, amount) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyLossTracker.get(portfolioId) || { date: today, loss: 0 };
  if (entry.date !== today) {
    // New trading day — reset
    entry.date = today;
    entry.loss = 0;
  }
  entry.loss += amount;
  dailyLossTracker.set(portfolioId, entry);
  logger.info(`[Risk] Daily loss for ${portfolioId}: ₹${entry.loss.toFixed(2)}`);
}

/**
 * Check whether today's loss has breached the daily loss limit.
 * @param {string} portfolioId
 * @param {number} capital     - Current portfolio capital
 * @returns {{ blocked: boolean, reason: string, lossSoFar: number }}
 */
function checkDailyLossLimit(portfolioId, capital) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyLossTracker.get(portfolioId) || { date: today, loss: 0 };
  if (entry.date !== today) { entry.loss = 0; }

  const maxAllowedLoss = capital * R.MAX_DAILY_LOSS_PCT;
  const blocked = entry.loss >= maxAllowedLoss;

  return {
    blocked,
    reason: blocked
      ? `Daily loss ₹${entry.loss.toFixed(2)} has reached limit ₹${maxAllowedLoss.toFixed(2)} (${(R.MAX_DAILY_LOSS_PCT * 100).toFixed(1)}% of ₹${capital.toFixed(2)})`
      : 'Within daily loss limit',
    lossSoFar:      entry.loss,
    limitAmount:    maxAllowedLoss,
    remainingBudget: Math.max(0, maxAllowedLoss - entry.loss),
  };
}

// ─── Position Sizing ─────────────────────────────────────────────────────────

/**
 * Fixed Fractional position sizing.
 *
 * Risk formula:
 *   riskAmount = capital × riskPct
 *   riskPerShare = entryPrice × stopLossPct
 *   quantity = floor(riskAmount / riskPerShare)
 *
 * @param {{
 *   capital:     number,   // Available capital in ₹
 *   entryPrice:  number,   // Entry price per share
 *   stopLossPct: number,   // Fractional stop-loss, e.g. 0.02 = 2%
 *   riskPct:     number,   // Fraction of capital to risk, e.g. 0.01 = 1%
 * }} params
 * @returns {{ quantity: number, riskAmount: number, riskPerShare: number, positionValue: number }}
 */
function fixedFractionalSize({ capital, entryPrice, stopLossPct, riskPct }) {
  if (!capital || !entryPrice || !stopLossPct || !riskPct) {
    throw new Error('[Risk] fixedFractionalSize: missing required parameters');
  }

  const riskAmount   = capital * riskPct;
  const riskPerShare = entryPrice * stopLossPct;

  if (riskPerShare <= 0) {
    throw new Error('[Risk] riskPerShare must be > 0 — check entryPrice and stopLossPct');
  }

  const rawQty      = riskAmount / riskPerShare;
  const quantity    = Math.floor(rawQty);
  const positionValue = quantity * entryPrice;

  // Guard: position should not exceed total capital
  const maxQty   = Math.floor(capital / entryPrice);
  const finalQty = Math.min(quantity, maxQty);

  logger.debug(
    `[Risk] FixedFractional: capital=${capital} | entry=${entryPrice} | ` +
    `risk=${(riskPct * 100).toFixed(1)}% | sl=${(stopLossPct * 100).toFixed(1)}% | qty=${finalQty}`
  );

  return {
    quantity:      finalQty,
    riskAmount:    finalQty * riskPerShare,
    riskPerShare:  parseFloat(riskPerShare.toFixed(4)),
    positionValue: parseFloat((finalQty * entryPrice).toFixed(2)),
    capitalUsedPct: parseFloat(((finalQty * entryPrice) / capital * 100).toFixed(2)),
  };
}

/**
 * Kelly Criterion position sizing (half-Kelly for safety).
 *
 * f* = (p × B − q) / B   where q = 1 − p
 *
 * @param {{
 *   capital:       number,
 *   entryPrice:    number,
 *   winRate:       number,   // Historical win rate, e.g. 0.55
 *   avgWinPct:     number,   // Average win as fraction, e.g. 0.04
 *   avgLossPct:    number,   // Average loss as fraction (positive), e.g. 0.02
 *   kellyFraction: number,   // Safety fraction, default 0.5 (half-Kelly)
 * }}
 */
function kellyCriterionSize({ capital, entryPrice, winRate, avgWinPct, avgLossPct, kellyFraction = 0.5 }) {
  if (winRate <= 0 || winRate >= 1)    throw new Error('[Risk] winRate must be in (0, 1)');
  if (avgWinPct <= 0 || avgLossPct <= 0) throw new Error('[Risk] avgWinPct / avgLossPct must be > 0');

  const B = avgWinPct / avgLossPct;   // Win/loss ratio
  const p = winRate;
  const q = 1 - winRate;

  const kelly = (p * B - q) / B;

  if (kelly <= 0) {
    logger.warn(`[Risk] Kelly fraction is ${kelly.toFixed(4)} — negative edge, no position recommended`);
    return { quantity: 0, kellyFraction: 0, positionValue: 0, edge: kelly };
  }

  const safeKelly   = kelly * kellyFraction;
  const allocAmount = capital * safeKelly;
  const quantity    = Math.floor(allocAmount / entryPrice);

  logger.debug(
    `[Risk] Kelly: p=${p} | B=${B.toFixed(3)} | rawKelly=${kelly.toFixed(4)} | ` +
    `safeKelly=${safeKelly.toFixed(4)} | qty=${quantity}`
  );

  return {
    quantity,
    kellyFull:     parseFloat(kelly.toFixed(6)),
    kellySafe:     parseFloat(safeKelly.toFixed(6)),
    positionValue: parseFloat((quantity * entryPrice).toFixed(2)),
    edge:          parseFloat(((p * B - q) / B * 100).toFixed(4)),
  };
}

// ─── Stop Loss / Take Profit ──────────────────────────────────────────────────

/**
 * Compute stop-loss and take-profit levels.
 *
 * @param {{
 *   entryPrice:     number,
 *   side:           'BUY' | 'SELL',
 *   stopLossPct:    number,   // e.g. 0.02
 *   takeProfitPct:  number,   // e.g. 0.04
 * }}
 * @returns {{ stopLoss: number, takeProfit: number, riskRewardRatio: number }}
 */
function computeLevels({ entryPrice, side, stopLossPct, takeProfitPct }) {
  const sl  = stopLossPct   ?? R.DEFAULT_STOP_LOSS_PCT;
  const tp  = takeProfitPct ?? R.DEFAULT_TAKE_PROFIT_PCT;

  let stopLoss, takeProfit;

  if (side === 'BUY') {
    stopLoss   = entryPrice * (1 - sl);
    takeProfit = entryPrice * (1 + tp);
  } else {
    stopLoss   = entryPrice * (1 + sl);
    takeProfit = entryPrice * (1 - tp);
  }

  const riskRewardRatio = tp / sl;

  return {
    stopLoss:        parseFloat(stopLoss.toFixed(2)),
    takeProfit:      parseFloat(takeProfit.toFixed(2)),
    riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
  };
}

/**
 * Full risk check before placing a new trade.
 * Returns { approved, reasons[] }.
 */
function validateTrade({ capital, entryPrice, quantity, side, portfolioId, openPositions = 0 }) {
  const reasons = [];
  let approved = true;

  // 1. Max open positions
  if (openPositions >= R.MAX_OPEN_POSITIONS) {
    reasons.push(`Max open positions (${R.MAX_OPEN_POSITIONS}) reached`);
    approved = false;
  }

  // 2. Daily loss limit
  const dailyCheck = checkDailyLossLimit(portfolioId || 'default', capital);
  if (dailyCheck.blocked) {
    reasons.push(dailyCheck.reason);
    approved = false;
  }

  // 3. Trade size vs capital
  const tradeValue = entryPrice * quantity;
  if (tradeValue > capital) {
    reasons.push(`Trade value ₹${tradeValue.toFixed(2)} exceeds available capital ₹${capital.toFixed(2)}`);
    approved = false;
  }

  // 4. Minimum trade size (avoid tiny positions)
  if (quantity < 1) {
    reasons.push('Quantity must be at least 1');
    approved = false;
  }

  return { approved, reasons, tradeValue };
}

module.exports = {
  fixedFractionalSize,
  kellyCriterionSize,
  computeLevels,
  validateTrade,
  checkDailyLossLimit,
  recordDailyLoss,
};
