// src/routes/portfolio.js
//
// NOTE: This router existed but was never mounted in app.js, so multi-asset
// backtesting / portfolio signal ranking / capital allocation were built but
// completely unreachable. Mounted at /api/portfolio in app.js. requireAuth
// added below since none of these existed before (same pattern as every
// other authenticated route in the app).
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/portfolioController');
const { requireAuth } = require('../middleware/authMiddleware');
const { backtestLimiter } = require('../middleware/rateLimiter');

router.use(requireAuth);

router.post('/backtest',  backtestLimiter, ctrl.runBacktest);  // Multi-asset backtest — CPU-intensive, same limiter as /api/backtest
router.post('/signals',   ctrl.getPortfolioSignals);            // Ranked signals for symbols
router.post('/allocate',  ctrl.computeAllocation);               // Capital allocation

module.exports = router;
