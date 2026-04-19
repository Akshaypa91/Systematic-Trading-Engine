// src/routes/auth.js — HARDENED (routes mounted before notFound)
'use strict';

const router     = require('express').Router();
const ctrl       = require('../controllers/authController');
const upstoxCtrl = require('../controllers/upstoxAuthController');
const { requireAuth } = require('../middleware/authMiddleware');
const logger     = require('../config/logger');

// Debug: log every hit to this router
router.use((req, _res, next) => {
  logger.debug(`[AuthRouter] ${req.method} ${req.originalUrl}`);
  next();
});

// ── App auth ──────────────────────────────────────────────────────────────────
router.post('/signup', ctrl.signup);
router.post('/login',  ctrl.login);
router.get ('/me',     ctrl.me);

// ── Upstox OAuth ──────────────────────────────────────────────────────────────
// CRITICAL: callback must NOT require auth — Upstox hits it unauthenticated
router.get ('/upstox/login',    upstoxCtrl.login);
router.get ('/upstox/callback', upstoxCtrl.callback);   // no requireAuth!
router.get ('/upstox/status',   requireAuth, upstoxCtrl.status);
router.post('/upstox/logout',   requireAuth, upstoxCtrl.logout);
router.post('/upstox/token',    requireAuth, upstoxCtrl.setToken);  // manual inject

module.exports = router;
