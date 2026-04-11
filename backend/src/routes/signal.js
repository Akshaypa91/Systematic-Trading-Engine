// src/routes/signal.js — UPGRADED with regime route
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/signalController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/describe',          ctrl.describeStrategies);       // public — no auth needed for strategy descriptions
router.get('/history/:symbol',   requireAuth, ctrl.getSignalHistory);
router.get('/regime/:symbol',    requireAuth, ctrl.getRegime);
router.get('/:symbol',           requireAuth, ctrl.getSignal);

module.exports = router;
