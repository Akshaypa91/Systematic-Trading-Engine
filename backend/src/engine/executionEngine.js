// src/engine/executionEngine.js
// Paper trading simulation — full order lifecycle management

'use strict';

const { v4: uuidv4 } = require('crypto');
const db         = require('../config/database');
const riskMgr    = require('../risk/riskManager');
const C          = require('../config/constants');
const logger     = require('../config/logger');

// ─── Simple UUID without external dep ─────────────────────────────────────────
function generateOrderId() {
  return `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ─── In-memory portfolio state (mirrors DB) ───────────────────────────────────
// In production, source of truth is the DB; this is a write-through cache.
const _state = {
  capital:      parseFloat(process.env.DEFAULT_CAPITAL || C.RISK.DEFAULT_CAPITAL),
  openPositions: new Map(),   // symbol → position object
  dailyPnl:     0,
};

/**
 * Get current portfolio state (read-only snapshot).
 */
function getPortfolioState() {
  return {
    capital:      _state.capital,
    openPositions: Object.fromEntries(_state.openPositions),
    openCount:    _state.openPositions.size,
    dailyPnl:     _state.dailyPnl,
  };
}

/**
 * Place a paper trade order.
 *
 * @param {{
 *   symbol:        string,
 *   side:          'BUY' | 'SELL',
 *   quantity:      number,
 *   orderType:     'MARKET' | 'LIMIT',
 *   limitPrice?:   number,
 *   currentPrice:  number,   // For MARKET orders
 *   stopLossPct?:  number,
 *   takeProfitPct?: number,
 *   strategy?:     string,
 *   signalId?:     number,
 * }} orderParams
 * @returns {Promise<Object>} Executed order
 */
async function placeOrder(orderParams) {
  const {
    symbol,
    side,
    quantity,
    orderType    = 'MARKET',
    limitPrice   = null,
    currentPrice,
    stopLossPct  = C.RISK.DEFAULT_STOP_LOSS_PCT,
    takeProfitPct = C.RISK.DEFAULT_TAKE_PROFIT_PCT,
    strategy     = null,
    signalId     = null,
  } = orderParams;

  // ── Risk validation ────────────────────────────────────────────────────
  const validation = riskMgr.validateTrade({
    capital:       _state.capital,
    entryPrice:    currentPrice,
    quantity,
    side,
    portfolioId:   'default',
    openPositions: _state.openPositions.size,
  });

  if (!validation.approved) {
    logger.warn(`[Exec] Order REJECTED for ${symbol}: ${validation.reasons.join('; ')}`);
    return {
      status:   'REJECTED',
      symbol,
      side,
      quantity,
      reasons:  validation.reasons,
    };
  }

  // ── Guard: prevent duplicate long entry for same symbol ───────────────
  if (side === 'BUY' && _state.openPositions.has(symbol)) {
    const existing = _state.openPositions.get(symbol);
    logger.warn(`[Exec] BUY REJECTED for ${symbol}: position already open (entry=₹${existing.entryPrice}, qty=${existing.qty})`);
    return {
      status:  'REJECTED',
      symbol, side, quantity,
      reasons: [`Position already open for ${symbol} — close existing position before re-entering`],
    };
  }

  // ── Determine fill price ───────────────────────────────────────────────
  const slippage    = C.BACKTEST.SLIPPAGE_PCT;
  const commission  = C.BACKTEST.COMMISSION_PCT;

  const fillPrice = orderType === 'LIMIT' && limitPrice
    ? limitPrice
    : side === 'BUY'
      ? currentPrice * (1 + slippage)
      : currentPrice * (1 - slippage);

  const commissionAmt = fillPrice * quantity * commission;
  const totalCost     = side === 'BUY'
    ? fillPrice * quantity + commissionAmt
    : 0;

  if (side === 'BUY' && totalCost > _state.capital) {
    return {
      status:  'REJECTED',
      symbol, side, quantity,
      reasons: [`Insufficient capital: need ₹${totalCost.toFixed(2)}, have ₹${_state.capital.toFixed(2)}`],
    };
  }

  // ── Compute stop/TP levels ─────────────────────────────────────────────
  const levels = riskMgr.computeLevels({ entryPrice: fillPrice, side, stopLossPct, takeProfitPct });

  // ── Build order record ─────────────────────────────────────────────────
  const orderId = generateOrderId();
  const order = {
    orderId,
    symbol,
    side,
    quantity,
    orderType,
    limitPrice,
    executedPrice:  parseFloat(fillPrice.toFixed(4)),
    stopLossPrice:  levels.stopLoss,
    takeProfitPrice:levels.takeProfit,
    commission:     parseFloat(commissionAmt.toFixed(4)),
    strategy,
    signalId,
    status:         'EXECUTED',
    executedAt:     new Date().toISOString(),
  };

  // ── Update in-memory state ─────────────────────────────────────────────
  if (side === 'BUY') {
    _state.capital -= totalCost;
    _state.openPositions.set(symbol, {
      symbol,
      qty:            quantity,
      entryPrice:     fillPrice,
      stopLoss:       levels.stopLoss,
      takeProfit:     levels.takeProfit,
      openedAt:       order.executedAt,
      orderId,
      strategy,
    });
  } else {
    // SELL — close position if open
    const pos = _state.openPositions.get(symbol);
    if (pos) {
      const sellProceeds = fillPrice * quantity - commissionAmt;
      const pnl          = sellProceeds - (pos.entryPrice * quantity);
      _state.capital    += sellProceeds;
      _state.dailyPnl   += pnl;
      order.pnl          = parseFloat(pnl.toFixed(2));
      order.pnlPct       = parseFloat(((pnl / (pos.entryPrice * quantity)) * 100).toFixed(4));

      if (pnl < 0) riskMgr.recordDailyLoss('default', Math.abs(pnl));
      _state.openPositions.delete(symbol);
    }
  }

  // ── Persist to DB (best-effort) ────────────────────────────────────────
  try {
    await persistOrder(order);
  } catch (err) {
    logger.error(`[Exec] DB persist failed for ${orderId}: ${err.message}`);
  }

  logger.info(
    `[Exec] ${side} ${quantity} × ${symbol} @₹${fillPrice.toFixed(2)} | ` +
    `commission=₹${commissionAmt.toFixed(2)} | capital=₹${_state.capital.toFixed(2)}`
  );

  return { ...order, portfolioState: getPortfolioState() };
}

/**
 * Check an open position against current market price.
 * Returns hit stop-loss or take-profit if applicable.
 */
async function checkAndClosePosition(symbol, currentPrice) {
  const pos = _state.openPositions.get(symbol);
  if (!pos) return null;

  let closeReason = null;
  if (currentPrice <= pos.stopLoss)  closeReason = 'STOP_LOSS';
  if (currentPrice >= pos.takeProfit) closeReason = 'TAKE_PROFIT';

  if (closeReason) {
    logger.info(`[Exec] Auto-close ${symbol} via ${closeReason} at ₹${currentPrice}`);
    return placeOrder({
      symbol,
      side:         'SELL',
      quantity:     pos.qty,
      orderType:    'MARKET',
      currentPrice,
      strategy:     pos.strategy,
    });
  }
  return null;
}

async function persistOrder(order) {
  await db.query(`
    INSERT INTO paper_trades
      (order_id, symbol, order_type, side, quantity, limit_price,
       executed_price, status, strategy, signal_id, stop_loss_price,
       take_profit_price, pnl, pnl_pct, commission, executed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    order.orderId, order.symbol, order.orderType, order.side, order.quantity,
    order.limitPrice, order.executedPrice, order.status, order.strategy,
    order.signalId, order.stopLossPrice, order.takeProfitPrice,
    order.pnl || null, order.pnlPct || null, order.commission,
    order.executedAt,
  ]);
}

/**
 * Get recent paper trades from DB.
 */
async function getRecentOrders(limit = 50) {
  const [rows] = await db.query(`
    SELECT * FROM paper_trades
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit]);
  return rows;
}

module.exports = {
  placeOrder,
  getPortfolioState,
  checkAndClosePosition,
  getRecentOrders,
};
