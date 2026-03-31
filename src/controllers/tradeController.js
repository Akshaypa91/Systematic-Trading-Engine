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

module.exports = { placeOrder, getPortfolio, getOrders, checkExits, computeSize };
