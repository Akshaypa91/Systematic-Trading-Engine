// src/controllers/tradeController.js
'use strict';

const exec    = require('../engine/executionEngine');
const riskMgr = require('../risk/riskManager');
const logger  = require('../config/logger');

/**
 * POST /api/trade/order
 * Body: { symbol, side, quantity, currentPrice, orderType,
 *         limitPrice, stopLossPct, takeProfitPct, strategy }
 */
async function placeOrder(req, res) {
  try {
    const result = await exec.placeOrder(req.body);
    const status = result.status === 'REJECTED' ? 422 : 201;
    res.status(status).json({ success: result.status !== 'REJECTED', ...result });
  } catch (err) {
    logger.error(`[TradeCtrl] placeOrder: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/trade/portfolio
 */
function getPortfolio(req, res) {
  res.json({ success: true, data: exec.getPortfolioState() });
}

/**
 * GET /api/trade/orders?limit=50
 */
async function getOrders(req, res) {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const orders = await exec.getRecentOrders(limit);
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/trade/check-exits
 * Body: { prices: [{ symbol, currentPrice }] }
 * Checks all open positions against provided prices, auto-closes SL/TP hits.
 */
async function checkExits(req, res) {
  try {
    const { prices = [] } = req.body;
    const results = [];
    for (const { symbol, currentPrice } of prices) {
      const r = await exec.checkAndClosePosition(symbol, currentPrice);
      if (r) results.push(r);
    }
    res.json({ success: true, closedPositions: results.length, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/trade/size
 * Compute position size without placing an order.
 * Body: { capital, entryPrice, stopLossPct, riskPct, method }
 */
function computeSize(req, res) {
  try {
    const { capital, entryPrice, stopLossPct, riskPct = 0.02, method = 'fixed' } = req.body;
    if (!capital || !entryPrice || !stopLossPct) {
      return res.status(400).json({ success: false, error: 'capital, entryPrice, stopLossPct required' });
    }

    let sizing;
    if (method === 'kelly') {
      const { winRate = 0.55, avgWinPct = 0.04, avgLossPct = 0.02 } = req.body;
      sizing = riskMgr.kellyCriterionSize({ capital, entryPrice, winRate, avgWinPct, avgLossPct });
    } else {
      sizing = riskMgr.fixedFractionalSize({ capital, entryPrice, stopLossPct, riskPct });
    }

    const levels = riskMgr.computeLevels({
      entryPrice,
      side: 'BUY',
      stopLossPct,
      takeProfitPct: req.body.takeProfitPct || 0.04,
    });

    res.json({ success: true, method, sizing, levels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


/**
 * POST /api/trade/manual
 * Body: { symbol, action, qty }
 *
 * Frontend-facing manual trade entry. Translates the simplified
 * { action, qty } shape into the executionEngine's { side, quantity }
 * convention and delegates to the same placeOrder path as automated
 * trades — so risk checks, deduplication, and DB logging all apply.
 *
 * Response: { success, message, trade: { symbol, action, qty, ... } }
 */
async function placeManualOrder(req, res) {
  try {
    const { symbol, action, qty } = req.body;

    // ── Validate required fields ──────────────────────────────────────────
    const missing = [];
    if (!symbol) missing.push('symbol');
    if (!action) missing.push('action');
    if (qty === undefined || qty === null || qty === '') missing.push('qty');
    if (missing.length) {
      return res.status(400).json({
        success: false,
        error:   `Missing required fields: ${missing.join(', ')}`,
      });
    }

    const sym = String(symbol).trim().toUpperCase();

    const normalizedAction = String(action).trim().toUpperCase();
    if (!['BUY', 'SELL'].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        error:   `action must be "BUY" or "SELL", got "${action}"`,
      });
    }

    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        error:   `qty must be a positive number, got "${qty}"`,
      });
    }

    if (!Number.isInteger(quantity)) {
      return res.status(400).json({
        success: false,
        error:   `qty must be a whole number (shares), got ${quantity}`,
      });
    }

    logger.info(`[TradeCtrl] Manual order: ${normalizedAction} ${quantity} × ${sym}`);

    // ── Fetch live price so executionEngine can value the position ────────
    let currentPrice = null;
    try {
      const marketDataService = require('../services/marketDataService');
      const priceResult = await marketDataService.getLivePrice(sym);
      currentPrice = priceResult.price;
      logger.info(`[TradeCtrl] Manual order price: ${sym} = ₹${currentPrice} (${priceResult.source})`);
    } catch (priceErr) {
      logger.warn(`[TradeCtrl] Could not fetch price for ${sym}: ${priceErr.message} — proceeding without currentPrice`);
    }

    // ── Delegate to executionEngine ───────────────────────────────────────
    // skipDedup + skipCooldown so manual orders are never silently swallowed
    const result = await exec.placeOrder({
      symbol:       sym,
      side:         normalizedAction,   // BUY | SELL
      quantity,
      currentPrice,
      orderType:    'MARKET',
      strategy:     'MANUAL',
      skipDedup:    true,
      skipCooldown: true,
    });

    // ── Surface REJECTED orders as 422 (not 500) ─────────────────────────
    if (result.status === 'REJECTED') {
      return res.status(422).json({
        success: false,
        error:   `Order rejected: ${(result.reasons || []).join('; ')}`,
        details: result,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Trade executed',
      trade: {
        symbol:    sym,
        action:    normalizedAction,
        qty:       quantity,
        price:     currentPrice,
        orderId:   result.orderId,
        status:    result.status,
        executedAt: result.executedAt || new Date().toISOString(),
      },
      portfolio: result.portfolioState || null,
    });

  } catch (err) {
    logger.error(`[TradeCtrl] placeManualOrder: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { placeOrder, placeManualOrder, getPortfolio, getOrders, checkExits, computeSize,
  // Alias: routes/index.js references checkPosition for GET /trade/check/:symbol
  checkPosition: async (req, res) => {
    try {
      const { symbol }       = req.params;
      const { currentPrice } = req.query;
      if (!currentPrice) {
        return res.status(400).json({ success: false, error: 'currentPrice query param required' });
      }
      const price  = parseFloat(currentPrice);
      if (!isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, error: 'currentPrice must be a positive number' });
      }
      const result = await exec.checkAndClosePosition(symbol.toUpperCase(), price);
      res.json({ success: true, closed: !!result, data: result || null });
    } catch (err) {
      logger.error(`[TradeCtrl] checkPosition: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  },
};