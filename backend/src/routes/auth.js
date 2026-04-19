// src/routes/auth.js
'use strict';

const router       = require('express').Router();
const ctrl         = require('../controllers/authController');
const upstoxCtrl   = require('../controllers/upstoxAuthController');
const googleCtrl   = require('../controllers/googleAuthController');
const { requireAuth } = require('../middleware/authMiddleware');
const logger       = require('../config/logger');

router.use((req, _res, next) => {
  logger.debug(`[AuthRouter] ${req.method} ${req.originalUrl}`);
  next();
});

// ── Local auth ────────────────────────────────────────────────────────────────
router.post('/signup', ctrl.signup);
router.post('/login',  ctrl.login);
router.get ('/me',     ctrl.me);

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.post('/google', googleCtrl.googleAuth);   // no requireAuth — public

// ── Upstox OAuth ──────────────────────────────────────────────────────────────
router.get ('/upstox/login',    upstoxCtrl.login);
router.get ('/upstox/callback', upstoxCtrl.callback);
router.get ('/upstox/status',   requireAuth, upstoxCtrl.status);
router.post('/upstox/logout',   requireAuth, upstoxCtrl.logout);
router.post('/upstox/token',    requireAuth, upstoxCtrl.setToken);

module.exports = router;
