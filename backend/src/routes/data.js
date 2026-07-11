'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/dataController');
const { requireAuth } = require('../middleware/authMiddleware');

// Health check — API connectivity + cache diagnostics (public, no auth needed)
router.get('/health',                   ctrl.getDataHealth);

// Unified stock endpoint — price + signal + indicators in one call
router.get('/stock/:symbol',            ctrl.getStock);

// Read-only data endpoints — public (market data, quotes)
router.get('/search',                   ctrl.searchStocks);    // symbol/name search (curated + full NSE master)
router.get('/quote/:symbol',            ctrl.getQuote);
router.get('/candles/:symbol',          ctrl.getCandles);      // Upstox OHLC candles for the chart
router.get('/historical/:symbol',       ctrl.getHistorical);
router.get('/prices/:symbol',           ctrl.getPrices);
router.get('/nifty50',                  ctrl.getNifty50);
router.get('/market-status',            ctrl.getMarketStatus);

// FIX Bug 16: fetch-and-store is a write operation (hits NSE + writes to DB)
// — must be protected to prevent abuse / unauthenticated data ingestion
router.post('/fetch-and-store/:symbol', requireAuth, ctrl.fetchAndStore);

module.exports = router;