'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/backtestController');

router.post('/',                     ctrl.runBacktest);
router.get('/runs',                  ctrl.getBacktestRuns);
router.get('/runs/:runId/trades',    ctrl.getBacktestTrades);

module.exports = router;
