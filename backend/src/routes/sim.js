// src/routes/sim.js — Simulation mode live trading API
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/simController');

router.get('/signals',          ctrl.getLiveSignals);
router.get('/portfolio',        ctrl.getPortfolio);
router.get('/trades',           ctrl.getTrades);
router.get('/equity',           ctrl.getEquityCurve);
router.get('/status',           ctrl.getStatus);
router.post('/engine/start',    ctrl.startEngine);
router.post('/engine/stop',     ctrl.stopEngine);
router.post('/watchlist/add',   ctrl.addToWatchlist);
router.post('/watchlist/remove',ctrl.removeFromWatchlist);

module.exports = router;
