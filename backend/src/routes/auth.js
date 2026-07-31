// src/routes/auth.js
'use strict';

const router     = require('express').Router();
const ctrl       = require('../controllers/authController');
const upstoxCtrl = require('../controllers/upstoxAuthController');
const googleCtrl = require('../controllers/googleAuthController');
const { requireAuth } = require('../middleware/authMiddleware');
const logger     = require('../config/logger');

router.use((req, _res, next) => {
  logger.debug(`[AuthRouter] ${req.method} ${req.originalUrl}`);
  next();
});

// ── Local auth ────────────────────────────────────────────────────────────────
router.post('/signup',          ctrl.signup);
router.post('/login',           ctrl.login);
router.get ('/me',              requireAuth, ctrl.me);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password',  ctrl.resetPassword);

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.post('/google', googleCtrl.googleAuth);

// ── Upstox OAuth ──────────────────────────────────────────────────────────────
router.get ('/upstox/link',     requireAuth, upstoxCtrl.linkUrl);  // signed, user-bound authorize URL
router.get ('/upstox/login',    upstoxCtrl.login);                  // legacy — cannot identify the user
router.get ('/upstox/callback', upstoxCtrl.callback);   // NO requireAuth — Upstox calls this
router.get ('/upstox/status',   requireAuth, upstoxCtrl.status);
router.post('/upstox/logout',   requireAuth, upstoxCtrl.logout);
router.post('/upstox/token',    requireAuth, upstoxCtrl.setToken);

module.exports = router;
