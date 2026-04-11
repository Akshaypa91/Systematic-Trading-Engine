'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/dataController');
const { requireAuth } = require('../middleware/authMiddleware');

// Read-only data endpoints — public (market data, quotes)
router.get('/quote/:symbol',            ctrl.getQuote);
router.get('/historical/:symbol',       ctrl.getHistorical);
router.get('/prices/:symbol',           ctrl.getPrices);
router.get('/nifty50',                  ctrl.getNifty50);
router.get('/market-status',            ctrl.getMarketStatus);

// FIX Bug 16: fetch-and-store is a write operation (hits NSE + writes to DB)
// — must be protected to prevent abuse / unauthenticated data ingestion
router.post('/fetch-and-store/:symbol', requireAuth, ctrl.fetchAndStore);

module.exports = router;
