// src/routes/index.js
//
// Mounted last, at /api, as a catch-all (see app.js). Because dedicated
// routers for /api/data, /api/signal, /api/backtest, /api/trade and
// /api/screener are mounted BEFORE this one, any route here that duplicates
// those paths is unreachable — Express never falls through to a later
// router once an earlier one has matched and responded. Those duplicates
// (previously ~21 routes) have been removed; only routes with no dedicated
// router (analytics/alerts/scheduler/info/health) live here.
'use strict';

const express = require('express');
const router  = express.Router();

const analyticsCtrl = require('../controllers/analyticsController');
const { requireAuth }  = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rbac');

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({
  status: 'ok',
  ts:     new Date().toISOString(),
  uptime: process.uptime(),
}));

router.get ('/analytics/backtest/:runId', requireAuth, analyticsCtrl.getBacktestAnalytics);
router.get ('/analytics/portfolio',       requireAuth, analyticsCtrl.getLiveAnalytics);
router.post('/analytics/optimize',        requireAuth, analyticsCtrl.runOptimizer);
router.get ('/analytics/optimizer/grids', requireAuth, analyticsCtrl.getParamGrids);
router.get ('/analytics/feed/stats',      requireAuth, analyticsCtrl.getFeedStats);

// ─── Alerts ──────────────────────────────────────────────────────────────────
router.post('/analytics/alerts',          requireAuth, analyticsCtrl.createAlert);
router.get ('/analytics/alerts',          requireAuth, analyticsCtrl.getAlerts);
router.get ('/analytics/alerts/recent',   requireAuth, analyticsCtrl.getRecentAlerts);
router.delete('/analytics/alerts/:id',    requireAuth, analyticsCtrl.deleteAlert);

// ─── System info ─────────────────────────────────────────────────────────────
router.get('/info', (req, res) => res.json({
  name:    'Systematic Trading Engine',
  version: require('../../package.json').version,
  node:    process.version,
  uptime:  process.uptime(),
  memory:  process.memoryUsage(),
  endpoints: [
    'GET  /api/health',
    'GET  /api/data/health',
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
// Was requireAuth only — any logged-in user (not just admins) could stop
// background jobs (market data refresh, signal generation, etc.) that
// affect every user of the platform. Now admin-only.
router.post('/scheduler/job/:name/stop', requireAuth, requireAdmin, (req, res) => {
  const ok = scheduler.stopJob(req.params.name);
  res.json({ success: ok, message: ok ? 'Job stopped' : 'Job not found' });
});

module.exports = router;
