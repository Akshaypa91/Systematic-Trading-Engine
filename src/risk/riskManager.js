// src/risk/riskManager.js
// Risk Management Engine — position sizing, stop-loss, daily limits.

'use strict';

const C      = require('../config/constants');
const logger = require('../config/logger');

const R = C.RISK;

// ── Daily Loss Tracker ────────────────────────────────────────────────────────
// Map: portfolioId → { date: 'YYYY-MM-DD', loss: number }
// IMPORTANT: in a multi-process deployment, replace with a Redis-backed store
// so the limit is enforced across all workers.
const _dailyLoss = new Map();

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _getEntry(portfolioId) {
  const today = _today();
  let entry   = _dailyLoss.get(portfolioId);
  if (!entry || entry.date !== today) {
    entry = { date: today, loss: 0 };
    _dailyLoss.set(portfolioId, entry);   // FIX: always write back
  }
  return entry;
}

/**
 * Record a realised loss.
 * @param {string} portfolioId
 * @param {number} amount - Positive number = loss amount (₹)
 */
function recordDailyLoss(portfolioId, amount) {
  if (typeof amount !== 'number' || amount < 0)
    throw new TypeError('recordDailyLoss: amount must be a non-negative number');
  const entry = _getEntry(portfolioId);
  entry.loss += amount;
  logger.info(`[Risk] Daily P&L for "${portfolioId}": −₹${entry.loss.toFixed(2)}`);
}

/**
 * Check whether today's cumulative loss has breached the daily limit.
 * @param {string} portfolioId
 * @param {number} capital - Current total portfolio value
 * @returns {{ blocked: boolean, reason: string, lossSoFar: number, remainingBudget: number }}
 */
function checkDailyLossLimit(portfolioId, capital) {
  if (!capital || capital <= 0) throw new RangeError('checkDailyLossLimit: capital must be > 0');
  const entry      = _getEntry(portfolioId);
  const limit      = capital * R.MAX_DAILY_LOSS_PCT;
  const blocked    = entry.loss >= limit;
  return {
    blocked,
    reason: blocked
      ? `Daily loss ₹${entry.loss.toFixed(2)} ≥ limit ₹${limit.toFixed(2)} (${(R.MAX_DAILY_LOSS_PCT * 100).toFixed(1)}% of ₹${capital.toFixed(2)})`
      : 'Within daily loss limit',
    lossSoFar:       parseFloat(entry.loss.toFixed(2)),
    limitAmount:     parseFloat(limit.toFixed(2)),
    remainingBudget: parseFloat(Math.max(0, limit - entry.loss).toFixed(2)),
  };
}

// ── Position Sizing ───────────────────────────────────────────────────────────

/**
 * Fixed Fractional sizing.
 *
 *   riskAmount   = capital × riskPct
 *   riskPerShare = entryPrice × stopLossPct
 *   quantity     = ⌊riskAmount / riskPerShare⌋
 *
 * Capped so positionValue ≤ capital.
 *
 * @throws {TypeError}  on missing / invalid params
 * @throws {RangeError} on zero or negative prices
 */
function fixedFractionalSize({ capital, entryPrice, stopLossPct, riskPct }) {
  if (capital     == null || entryPrice == null ||
      stopLossPct == null || riskPct    == null)
    throw new TypeError('[Risk] fixedFractionalSize: capital, entryPrice, stopLossPct, riskPct all required');
  if (capital     <= 0) throw new RangeError('[Risk] capital must be > 0');
  if (entryPrice  <= 0) throw new RangeError('[Risk] entryPrice must be > 0');
  if (stopLossPct <= 0 || stopLossPct >= 1) throw new RangeError('[Risk] stopLossPct must be in (0, 1)');
  if (riskPct     <= 0 || riskPct     >= 1) throw new RangeError('[Risk] riskPct must be in (0, 1)');

  const riskAmount   = capital * riskPct;
  const riskPerShare = entryPrice * stopLossPct;
  const rawQty       = riskAmount / riskPerShare;
  const maxQty       = Math.floor(capital / entryPrice);
  const quantity     = Math.min(Math.floor(rawQty), maxQty);

  if (quantity < 1) {
    logger.warn(
      `[Risk] FixedFractional: qty=0 — capital=₹${capital} is insufficient ` +
      `to take even 1 share at ₹${entryPrice} with ${(riskPct * 100).toFixed(1)}% risk`
    );
    return { quantity: 0, riskAmount: 0, riskPerShare, positionValue: 0, capitalUsedPct: 0 };
  }

  logger.debug(
    `[Risk] FixedFractional | entry=₹${entryPrice} | risk=${(riskPct*100).toFixed(1)}% | ` +
    `sl=${(stopLossPct*100).toFixed(1)}% | qty=${quantity}`
  );

  return {
    quantity,
    riskAmount:     parseFloat((quantity * riskPerShare).toFixed(2)),
    riskPerShare:   parseFloat(riskPerShare.toFixed(4)),
    positionValue:  parseFloat((quantity * entryPrice).toFixed(2)),
    capitalUsedPct: parseFloat(((quantity * entryPrice) / capital * 100).toFixed(2)),
  };
}

/**
 * Kelly Criterion sizing (half-Kelly by default for safety).
 *
 *   f* = (p × B − q) / B   where B = avgWin/avgLoss, q = 1−p
 *   allocate capital × f* × kellyFraction
 *
 * Returns { quantity: 0 } when edge is negative (no bet recommended).
 */
function kellyCriterionSize({
  capital, entryPrice, winRate, avgWinPct, avgLossPct, kellyFraction = 0.5,
}) {
  if (capital    <= 0) throw new RangeError('[Risk] capital must be > 0');
  if (entryPrice <= 0) throw new RangeError('[Risk] entryPrice must be > 0');
  if (winRate    <= 0 || winRate    >= 1) throw new RangeError('[Risk] winRate must be in (0, 1)');
  if (avgWinPct  <= 0) throw new RangeError('[Risk] avgWinPct must be > 0');
  if (avgLossPct <= 0) throw new RangeError('[Risk] avgLossPct must be > 0');

  const B     = avgWinPct / avgLossPct;
  const p     = winRate;
  const q     = 1 - p;
  const kelly = (p * B - q) / B;

  if (kelly <= 0) {
    logger.warn(`[Risk] Kelly=${kelly.toFixed(4)} — negative edge, no position`);
    return { quantity: 0, kellyFull: kelly, kellySafe: 0, positionValue: 0, edge: kelly };
  }

  const safe     = kelly * kellyFraction;
  const quantity = Math.max(0, Math.floor((capital * safe) / entryPrice));

  logger.debug(
    `[Risk] Kelly | B=${B.toFixed(3)} | rawKelly=${kelly.toFixed(4)} | ` +
    `safeKelly=${safe.toFixed(4)} | qty=${quantity}`
  );

  return {
    quantity,
    kellyFull:     parseFloat(kelly.toFixed(6)),
    kellySafe:     parseFloat(safe.toFixed(6)),
    positionValue: parseFloat((quantity * entryPrice).toFixed(2)),
    edge:          parseFloat((kelly * 100).toFixed(4)),
  };
}

// ── Stop-Loss / Take-Profit ───────────────────────────────────────────────────

/**
 * Compute stop-loss and take-profit price levels.
 *
 *   BUY:  stopLoss = entry × (1 − sl),  takeProfit = entry × (1 + tp)
 *   SELL: stopLoss = entry × (1 + sl),  takeProfit = entry × (1 − tp)
 */
function computeLevels({ entryPrice, side, stopLossPct, takeProfitPct }) {
  if (entryPrice <= 0) throw new RangeError('[Risk] entryPrice must be > 0');
  const sl = stopLossPct   ?? R.DEFAULT_STOP_LOSS_PCT;
  const tp = takeProfitPct ?? R.DEFAULT_TAKE_PROFIT_PCT;
  if (sl <= 0 || tp <= 0) throw new RangeError('[Risk] stopLossPct and takeProfitPct must be > 0');

  const isBuy      = side !== 'SELL';
  const stopLoss   = isBuy ? entryPrice * (1 - sl) : entryPrice * (1 + sl);
  const takeProfit = isBuy ? entryPrice * (1 + tp) : entryPrice * (1 - tp);

  return {
    stopLoss:        parseFloat(stopLoss.toFixed(2)),
    takeProfit:      parseFloat(takeProfit.toFixed(2)),
    riskRewardRatio: parseFloat((tp / sl).toFixed(2)),
  };
}

// ── Trade validation ──────────────────────────────────────────────────────────

/**
 * Run all pre-trade risk checks.
 * @returns {{ approved: boolean, reasons: string[], tradeValue: number }}
 */
function validateTrade({ capital, entryPrice, quantity, side, portfolioId, openPositions = 0 }) {
  const reasons = [];

  if (quantity < 1)
    reasons.push('Quantity must be ≥ 1');

  if (capital <= 0)
    reasons.push('Capital must be > 0');

  const tradeValue = (entryPrice || 0) * (quantity || 0);
  if (tradeValue > capital)
    reasons.push(`Trade value ₹${tradeValue.toFixed(2)} exceeds capital ₹${capital.toFixed(2)}`);

  if (openPositions >= R.MAX_OPEN_POSITIONS)
    reasons.push(`Max open positions (${R.MAX_OPEN_POSITIONS}) reached`);

  if (capital > 0) {
    const daily = checkDailyLossLimit(portfolioId || 'default', capital);
    if (daily.blocked) reasons.push(daily.reason);
  }

  return { approved: reasons.length === 0, reasons, tradeValue };
}

module.exports = {
  fixedFractionalSize,
  kellyCriterionSize,
  computeLevels,
  validateTrade,
  checkDailyLossLimit,
  recordDailyLoss,
};
