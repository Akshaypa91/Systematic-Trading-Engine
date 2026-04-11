'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/backtestController');
const { requireAuth } = require('../middleware/authMiddleware');

router.post('/',                     requireAuth, ctrl.runBacktest);
router.get('/runs',                  requireAuth, ctrl.getBacktestRuns);
router.get('/runs/:runId/trades',    requireAuth, ctrl.getBacktestTrades);

module.exports = router;
