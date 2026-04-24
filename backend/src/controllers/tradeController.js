// src/controllers/tradeController.js
// ─────────────────────────────────────────────────────────────────────────────
// Trade controller — handles order placement, portfolio queries, and
// manual trades with full in-memory portfolio tracking.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const exec      = require('../engine/executionEngine');
const riskMgr   = require('../risk/riskManager');
const portfolio = require('../portfolio/portfolioState');
const logger    = require('../config/logger');

// ── Shared price-fetch utility ────────────────────────────────────────────────

/**
 * Fetch live price for a symbol.
 * Falls back to simulated price automatically via marketDataService.
 *
 * @param {string} symbol
 * @returns {Promise<{ price: number, source: string }>}
 */
async function fetchPrice(symbol) {
  const marketDataService = require('../services/marketDataService');
  const result = await marketDataService.getLivePrice(symbol);
  return { price: result.price, source: result.source };
}

// ── POST /api/trade/order ─────────────────────────────────────────────────────

/**
 * Place an automated/strategy order via executionEngine.
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

// ── GET /api/trade/portfolio ──────────────────────────────────────────────────

function getPortfolio(req, res) {
  try {
    const data = exec.getPortfolioState() ?? {};
    // Ensure safe shape — never return undefined fields
    const safe = {
      capital:       Number(data.capital ?? 0),
      openPositions: data.openPositions   ?? {},
      openCount:     Number(data.openCount ?? 0),
      dailyPnl:      Number(data.dailyPnl  ?? 0),
    };
    res.json({ success: true, data: safe });
  } catch (err) {
    logger.error(`[TradeCtrl] getPortfolio: ${err.message}`);
    res.json({ success: true, data: { capital: 0, openPositions: {}, openCount: 0, dailyPnl: 0 } });
  }
}

// ── GET /api/trade/orders ─────────────────────────────────────────────────────

async function getOrders(req, res) {
  try {
    const limit  = parseInt(req.query.limit || '50', 10);
    const orders = await exec.getRecentOrders(limit);
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/trade/check-exits ───────────────────────────────────────────────

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

// ── POST /api/trade/size ──────────────────────────────────────────────────────

function computeSize(req, res) {
  try {
    const { capital, entryPrice, stopLossPct, riskPct = 0.02, method = 'fixed' } = req.body;
    if (!capital || !entryPrice || !stopLossPct) {
      return res.status(400).json({
        success: false,
        error:   'capital, entryPrice, stopLossPct required',
      });
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
      side:          'BUY',
      stopLossPct,
      takeProfitPct: req.body.takeProfitPct || 0.04,
    });

    res.json({ success: true, method, sizing, levels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/trade/manual ────────────────────────────────────────────────────

/**
 * Manual trade entry with full in-memory portfolio tracking.
 * Body: { symbol, action, qty, price? }
 *
 * - BUY:  checks capital, deducts cost, adds/updates position
 * - SELL: checks position exists, increases capital, reduces/removes position
 *
 * Response: { success, message, trade, portfolio }
 */
async function placeManualOrder(req, res) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  try {
    const { symbol, action, qty, price: bodyPrice } = req.body;

    // ── Validate ────────────────────────────────────────────────────────────
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

    logger.info(`[TradeCtrl] Manual ${normalizedAction} ${quantity} × ${sym}`);

    // ── Resolve price ───────────────────────────────────────────────────────
    let price  = null;
    let source = 'MANUAL';

    if (bodyPrice && Number.isFinite(Number(bodyPrice)) && Number(bodyPrice) > 0) {
      // Caller supplied a price (e.g. from frontend input)
      price  = parseFloat(Number(bodyPrice).toFixed(2));
      source = 'MANUAL';
      logger.info(`[TradeCtrl] Using caller-supplied price: ₹${price}`);
    } else {
      // Fetch from marketDataService (API → simulation fallback)
      try {
        const result = await fetchPrice(sym);
        price  = result.price;
        source = result.source;
        logger.info(`[TradeCtrl] Fetched price: ${sym} = ₹${price} (${source})`);
      } catch (priceErr) {
        logger.error(`[TradeCtrl] Cannot resolve price for ${sym}: ${priceErr.message}`);
        return res.status(500).json({
          success: false,
          error:   `Could not determine price for ${sym}: ${priceErr.message}`,
        });
      }
    }

    // ── Execute against portfolio ────────────────────────────────────────────
    let result;
    try {
      if (normalizedAction === 'BUY') {
        result = await portfolio.executeBuy(sym, quantity, price, source, userId);
      } else {
        result = await portfolio.executeSell(sym, quantity, price, source, userId);
      }
    } catch (execErr) {
      const code = execErr.statusCode || 400;
      return res.status(code).json({ success: false, error: execErr.message });
    }

    logger.info(
      `[TradeCtrl] ${normalizedAction} executed: ${quantity} × ${sym} @ ₹${price}` +
      (result.pnl != null ? ` | P&L: ₹${result.pnl}` : '')
    );

    const updatedState = await portfolio.getState(userId);
    return res.status(201).json({
      success:   true,
      message:   'Trade executed',
      trade:     { ...result.trade, priceSource: source },
      portfolio: updatedState,
    });

  } catch (err) {
    logger.error(`[TradeCtrl] placeManualOrder unexpected: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/sim/portfolio ────────────────────────────────────────────────────

/**
 * Return in-memory portfolio state for the manual trading engine.
 * Mounted in routes/sim.js → GET /api/sim/portfolio
 */
async function getManualPortfolio(req, res) {
  try {
    const state = await portfolio.getState();
    res.json({ success: true, data: state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── Alias kept for routes/index.js ───────────────────────────────────────────

const checkPosition = async (req, res) => {
  try {
    const { symbol }       = req.params;
    const { currentPrice } = req.query;
    if (!currentPrice) {
      return res.status(400).json({ success: false, error: 'currentPrice query param required' });
    }
    const price = parseFloat(currentPrice);
    if (!isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, error: 'currentPrice must be a positive number' });
    }
    const result = await exec.checkAndClosePosition(symbol.toUpperCase(), price);
    res.json({ success: true, closed: !!result, data: result || null });
  } catch (err) {
    logger.error(`[TradeCtrl] checkPosition: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  placeOrder,
  placeManualOrder,
  getPortfolio,
  getManualPortfolio,
  getOrders,
  checkExits,
  computeSize,
  checkPosition,
};
