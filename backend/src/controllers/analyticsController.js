// src/controllers/analyticsController.js
'use strict';

const portfolioAnalytics  = require('../engine/portfolioAnalytics');
const walkForwardOptimizer = require('../engine/walkForwardOptimizer');
const dataStore            = require('../data/dataStore');
const liveDataFeed         = require('../data/liveDataFeed');
const alertEngine          = require('../engine/alertEngine');
const C                    = require('../config/constants');
const logger               = require('../config/logger');

/**
 * GET /api/analytics/backtest/:runId
 */
async function getBacktestAnalytics(req, res) {
  try {
    const runId = parseInt(req.params.runId, 10);
    const userId = req.user?.userId ?? req.user?.id ?? null;
    const data  = await portfolioAnalytics.analyseBacktestRun(runId, userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[AnalyticsCtrl] getBacktestAnalytics: ${err.message}`);
    res.status(err.message.includes('not found') ? 404 : 500)
       .json({ success: false, error: err.message });
  }
}

/**
 * GET /api/analytics/portfolio
 */
async function getLiveAnalytics(req, res) {
  try {
    const userId = req.user?.userId ?? req.user?.id ?? null;
    const data = await portfolioAnalytics.getLivePortfolioAnalytics(userId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[AnalyticsCtrl] getLiveAnalytics: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/analytics/optimize
 * Body: { symbol, strategy, windows, metric, capital }
 */
async function runOptimizer(req, res) {
  try {
    const {
      symbol,
      strategy      = 'MEAN_REVERSION',
      windows       = 3,
      isFraction    = 0.70,
      metric        = 'sharpe',
      stopLossPct   = C.RISK.DEFAULT_STOP_LOSS_PCT,
      takeProfitPct = C.RISK.DEFAULT_TAKE_PROFIT_PCT,
      riskPerTrade  = C.RISK.MAX_RISK_PER_TRADE_PCT,
      capital       = C.BACKTEST.DEFAULT_CAPITAL,
    } = req.body;

    if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

    const prices = await dataStore.getDailyPrices(symbol.toUpperCase());
    if (!prices || prices.length < 500) {
      return res.status(422).json({
        success: false,
        error: `Walk-forward optimization needs at least 500 bars. Got ${prices?.length ?? 0}. Fetch more data first.`,
      });
    }

    const result = walkForwardOptimizer.runWalkForward({
      symbol: symbol.toUpperCase(),
      prices,
      strategy: strategy.toUpperCase(),
      windows: parseInt(windows, 10),
      isFraction: parseFloat(isFraction),
      metric,
      stopLossPct:   parseFloat(stopLossPct),
      takeProfitPct: parseFloat(takeProfitPct),
      riskPerTrade:  parseFloat(riskPerTrade),
      capital:       parseFloat(capital),
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[AnalyticsCtrl] runOptimizer: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/analytics/optimizer/grids
 * Returns the parameter grids available for optimization
 */
function getParamGrids(req, res) {
  res.json({ success: true, data: walkForwardOptimizer.PARAM_GRIDS });
}

/**
 * GET /api/analytics/feed/stats
 */
function getFeedStats(req, res) {
  res.json({ success: true, data: liveDataFeed.getStats() });
}

// ─── Alert endpoints ─────────────────────────────────────────────────────────

/**
 * POST /api/analytics/alerts
 * Body: { symbol, type, threshold }
 */
function createAlert(req, res) {
  try {
    const { symbol, type, threshold } = req.body;
    if (!symbol || !type) return res.status(400).json({ success: false, error: 'symbol and type required' });
    const id = alertEngine.addAlert({ symbol: symbol.toUpperCase(), type, threshold });
    res.status(201).json({ success: true, alertId: id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/analytics/alerts
 */
function getAlerts(req, res) {
  const { symbol } = req.query;
  res.json({ success: true, data: alertEngine.getAlerts(symbol) });
}

/**
 * DELETE /api/analytics/alerts/:id
 */
function deleteAlert(req, res) {
  const removed = alertEngine.removeAlert(req.params.id);
  res.json({ success: removed, message: removed ? 'Alert removed' : 'Alert not found' });
}

/**
 * GET /api/analytics/alerts/recent
 */
function getRecentAlerts(req, res) {
  const limit = parseInt(req.query.limit || '50', 10);
  res.json({ success: true, data: alertEngine.getRecentAlerts(limit) });
}

module.exports = {
  getBacktestAnalytics,
  getLiveAnalytics,
  runOptimizer,
  getParamGrids,
  getFeedStats,
  createAlert,
  getAlerts,
  deleteAlert,
  getRecentAlerts,
};
