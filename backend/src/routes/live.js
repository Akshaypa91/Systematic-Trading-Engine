// src/routes/live.js — Live signal engine REST API
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/liveController');
const { requireAuth } = require('../middleware/authMiddleware');

// Signal endpoints
router.get('/signals',           requireAuth, ctrl.getLiveSignals);
router.get('/signals/history',   requireAuth, ctrl.getSignalHistory);

// Trade endpoints
router.get('/trades',            requireAuth, ctrl.getLatestTrades);
router.get('/portfolio',         requireAuth, ctrl.getPaperPortfolio);

// Engine management
router.get('/status',            requireAuth, ctrl.getEngineStatus);
router.post('/engine/start',     requireAuth, ctrl.startEngine);
router.post('/engine/stop',      requireAuth, ctrl.stopEngine);
router.post('/engine/run',       requireAuth, ctrl.triggerRun);

// Watchlist management
router.post('/watchlist/add',    requireAuth, ctrl.addToWatchlist);
router.post('/watchlist/remove', requireAuth, ctrl.removeFromWatchlist);

// Safety
router.post('/circuit-breaker/reset', requireAuth, ctrl.resetCircuitBreaker);

module.exports = router;
