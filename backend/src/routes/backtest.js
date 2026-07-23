'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/backtestController');
const { requireAuth } = require('../middleware/authMiddleware');
const { backtestLimiter } = require('../middleware/rateLimiter');

// POST is CPU-intensive — rate limit only this
router.post('/',                     requireAuth, backtestLimiter, ctrl.runBacktest);
router.post('/portfolio',            requireAuth, backtestLimiter, ctrl.runPortfolio);
// GETs are cheap DB reads — no rate limit needed
router.get('/runs',                  requireAuth, ctrl.getBacktestRuns);
router.get('/runs/:runId/trades',    requireAuth, ctrl.getBacktestTrades);

module.exports = router;
