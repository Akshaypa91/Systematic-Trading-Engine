// src/routes/signal.js — UPGRADED with regime route
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/signalController');

router.get('/describe',          ctrl.describeStrategies);
router.get('/history/:symbol',   ctrl.getSignalHistory);
router.get('/regime/:symbol',    ctrl.getRegime);      // NEW
router.get('/:symbol',           ctrl.getSignal);

module.exports = router;
