// src/routes/sim.js — Simulation mode live trading API
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/simController');
const trade  = require('../controllers/tradeController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/signals',           requireAuth, ctrl.getLiveSignals);
router.get('/trades',            requireAuth, ctrl.getTrades);
router.get('/equity',            requireAuth, ctrl.getEquityCurve);
router.get('/status',            requireAuth, ctrl.getStatus);
router.post('/engine/start',     requireAuth, ctrl.startEngine);
router.post('/engine/stop',      requireAuth, ctrl.stopEngine);
router.post('/watchlist/add',    requireAuth, ctrl.addToWatchlist);
router.post('/watchlist/remove', requireAuth, ctrl.removeFromWatchlist);

// GET /api/sim/portfolio → in-memory manual portfolio state
router.get('/portfolio', requireAuth, trade.getManualPortfolio);

module.exports = router;