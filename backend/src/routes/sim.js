// src/routes/sim.js — Simulation mode + manual portfolio API
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/simController');
const trade  = require('../controllers/tradeController');
const { requireAuth } = require('../middleware/authMiddleware');

// ── Simulation engine ─────────────────────────────────────────────────────────
router.get('/signals',           requireAuth, ctrl.getLiveSignals);
router.get('/trades',            requireAuth, ctrl.getTrades);
router.get('/equity',            requireAuth, ctrl.getEquityCurve);
router.get('/status',            requireAuth, ctrl.getStatus);
router.post('/engine/start',     requireAuth, ctrl.startEngine);
router.post('/engine/stop',      requireAuth, ctrl.stopEngine);
router.post('/watchlist/add',    requireAuth, ctrl.addToWatchlist);
router.post('/watchlist/remove', requireAuth, ctrl.removeFromWatchlist);

// ── Manual portfolio ──────────────────────────────────────────────────────────
// GET  /api/sim/portfolio  → current portfolio state
// POST /api/sim/start      → initialize with user-defined capital
// POST /api/sim/reset      → reset to initial capital
router.get('/portfolio', requireAuth, ctrl.getPortfolio);
router.post('/start',    requireAuth, ctrl.startWithCapital);
router.post('/reset',    requireAuth, ctrl.resetPortfolio);
router.post('/exit-all', requireAuth, ctrl.exitAll);
router.post('/exit-one', requireAuth, ctrl.exitOne);

module.exports = router;
