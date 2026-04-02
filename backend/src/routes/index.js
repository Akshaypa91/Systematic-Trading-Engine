// src/routes/index.js
'use strict';

const express = require('express');
const router  = express.Router();

const dataCtrl     = require('../controllers/dataController');
const signalCtrl   = require('../controllers/signalController');
const backtestCtrl = require('../controllers/backtestController');
const tradeCtrl    = require('../controllers/tradeController');
const screenerCtrl = require('../controllers/screenerController');

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
  status: 'ok',
  ts:     new Date().toISOString(),
  uptime: process.uptime(),
}));

// ─── Data ─────────────────────────────────────────────────────────────────────
router.get ('/data/quote/:symbol',           dataCtrl.getQuote);
router.get ('/data/historical/:symbol',      dataCtrl.getHistorical);
router.post('/data/fetch-and-store/:symbol', dataCtrl.fetchAndStore);
router.get ('/data/prices/:symbol',          dataCtrl.getPrices);
router.get ('/data/nifty50',                 dataCtrl.getNifty50);
router.get ('/data/market-status',           dataCtrl.getMarketStatus);

// ─── Signals ──────────────────────────────────────────────────────────────────
router.get('/signal/describe',          signalCtrl.describeStrategies);
router.get('/signal/history/:symbol',   signalCtrl.getSignalHistory);
router.get('/signal/:symbol',           signalCtrl.getSignal);

// ─── Backtest ─────────────────────────────────────────────────────────────────
router.post('/backtest',                 backtestCtrl.runBacktest);
router.get ('/backtest/runs',            backtestCtrl.getBacktestRuns);
router.get ('/backtest/runs/:runId/trades', backtestCtrl.getBacktestTrades);

// ─── Paper Trading ────────────────────────────────────────────────────────────
router.post('/trade/order',              tradeCtrl.placeOrder);
router.get ('/trade/portfolio',          tradeCtrl.getPortfolio);
router.get ('/trade/orders',             tradeCtrl.getOrders);
router.get ('/trade/check/:symbol',      tradeCtrl.checkPosition);

// ─── Screener ─────────────────────────────────────────────────────────────────
router.get ('/screener',                 screenerCtrl.runScreener);
router.post('/screener',                 screenerCtrl.runScreener);
router.get ('/screener/score/:symbol',   screenerCtrl.scoreSymbol);

// ─── Analytics & Optimizer ───────────────────────────────────────────────────
const analyticsCtrl = require('../controllers/analyticsController');

router.get ('/analytics/backtest/:runId', analyticsCtrl.getBacktestAnalytics);
router.get ('/analytics/portfolio',       analyticsCtrl.getLiveAnalytics);
router.post('/analytics/optimize',        analyticsCtrl.runOptimizer);
router.get ('/analytics/optimizer/grids', analyticsCtrl.getParamGrids);
router.get ('/analytics/feed/stats',      analyticsCtrl.getFeedStats);

// ─── Alerts ──────────────────────────────────────────────────────────────────
router.post('/analytics/alerts',          analyticsCtrl.createAlert);
router.get ('/analytics/alerts',          analyticsCtrl.getAlerts);
router.get ('/analytics/alerts/recent',   analyticsCtrl.getRecentAlerts);
router.delete('/analytics/alerts/:id',    analyticsCtrl.deleteAlert);

// ─── System info ─────────────────────────────────────────────────────────────
router.get('/info', (req, res) => res.json({
  name:    'Systematic Trading Engine',
  version: require('../../package.json').version,
  node:    process.version,
  uptime:  process.uptime(),
  memory:  process.memoryUsage(),
  endpoints: [
    'GET  /api/health',
    'GET  /api/data/quote/:symbol',
    'GET  /api/data/historical/:symbol?from=DD-MM-YYYY&to=DD-MM-YYYY',
    'POST /api/data/fetch-and-store/:symbol',
    'GET  /api/data/prices/:symbol?limit=200',
    'GET  /api/data/nifty50',
    'GET  /api/data/market-status',
    'GET  /api/signal/:symbol?strategy=AGGREGATED&method=weighted',
    'GET  /api/signal/history/:symbol',
    'GET  /api/signal/describe',
    'POST /api/backtest',
    'GET  /api/backtest/runs',
    'GET  /api/backtest/runs/:runId/trades',
    'POST /api/trade/order',
    'GET  /api/trade/portfolio',
    'GET  /api/trade/orders',
    'GET  /api/trade/check/:symbol?currentPrice=X',
    'GET  /api/screener',
    'POST /api/screener',
    'GET  /api/screener/score/:symbol',
    'GET  /api/analytics/backtest/:runId',
    'GET  /api/analytics/portfolio',
    'POST /api/analytics/optimize',
    'GET  /api/analytics/optimizer/grids',
    'GET  /api/analytics/feed/stats',
    'POST /api/analytics/alerts',
    'GET  /api/analytics/alerts',
    'GET  /api/analytics/alerts/recent',
    'DELETE /api/analytics/alerts/:id',
    'WS   ws://host/ws  (subscribe/unsubscribe live price feed)',
  ],
}));

// ─── Scheduler status ─────────────────────────────────────────────────────────
const scheduler = require('../engine/scheduler');
router.get('/scheduler/status', (req, res) =>
  res.json({ success: true, data: scheduler.getJobStatus() }));
router.post('/scheduler/job/:name/stop', (req, res) => {
  const ok = scheduler.stopJob(req.params.name);
  res.json({ success: ok, message: ok ? 'Job stopped' : 'Job not found' });
});

module.exports = router;
