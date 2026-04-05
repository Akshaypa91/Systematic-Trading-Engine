// src/routes/portfolio.js
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/portfolioController');

router.post('/backtest',  ctrl.runBacktest);         // Multi-asset backtest
router.post('/signals',   ctrl.getPortfolioSignals); // Ranked signals for symbols
router.post('/allocate',  ctrl.computeAllocation);   // Capital allocation

module.exports = router;
