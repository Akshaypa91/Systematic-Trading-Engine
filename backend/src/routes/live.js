// src/routes/live.js — Live signal engine REST API
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/liveController');

// Signal endpoints
router.get('/signals',           ctrl.getLiveSignals);      // Latest cached signals
router.get('/signals/history',   ctrl.getSignalHistory);    // DB-persisted history

// Trade endpoints
router.get('/trades',            ctrl.getLatestTrades);     // Recent paper trades
router.get('/portfolio',         ctrl.getPaperPortfolio);   // Current paper portfolio

// Engine management
router.get('/status',            ctrl.getEngineStatus);     // Engine + scheduler status
router.post('/engine/start',     ctrl.startEngine);         // Start engine
router.post('/engine/stop',      ctrl.stopEngine);          // Stop engine
router.post('/engine/run',       ctrl.triggerRun);          // Trigger immediate run

// Watchlist management
router.post('/watchlist/add',    ctrl.addToWatchlist);
router.post('/watchlist/remove', ctrl.removeFromWatchlist);

// Safety
router.post('/circuit-breaker/reset', ctrl.resetCircuitBreaker);

module.exports = router;
