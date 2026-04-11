// src/routes/sim.js — Simulation mode live trading API
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/simController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/signals',           requireAuth, ctrl.getLiveSignals);
router.get('/portfolio',         requireAuth, ctrl.getPortfolio);
router.get('/trades',            requireAuth, ctrl.getTrades);
router.get('/equity',            requireAuth, ctrl.getEquityCurve);
router.get('/status',            requireAuth, ctrl.getStatus);
router.post('/engine/start',     requireAuth, ctrl.startEngine);
router.post('/engine/stop',      requireAuth, ctrl.stopEngine);
router.post('/watchlist/add',    requireAuth, ctrl.addToWatchlist);
router.post('/watchlist/remove', requireAuth, ctrl.removeFromWatchlist);

module.exports = router;
