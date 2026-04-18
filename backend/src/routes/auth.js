// src/routes/auth.js
'use strict';

const router      = require('express').Router();
const ctrl        = require('../controllers/authController');
const upstoxCtrl  = require('../controllers/upstoxAuthController');
const { requireAuth } = require('../middleware/authMiddleware');

// ── App auth ──────────────────────────────────────────────────────────────────
router.post('/signup', ctrl.signup);
router.post('/login',  ctrl.login);
router.get ('/me',     ctrl.me);

// ── Upstox OAuth ──────────────────────────────────────────────────────────────
// GET  /api/auth/upstox/login      → redirect to Upstox OAuth page
// GET  /api/auth/upstox/callback   → receive code, exchange for token
// GET  /api/auth/upstox/status     → token + WS connection status
// POST /api/auth/upstox/logout     → clear token, disconnect WS
router.get ('/upstox/login',    upstoxCtrl.login);
router.get ('/upstox/callback', upstoxCtrl.callback);
router.get ('/upstox/status',   requireAuth, upstoxCtrl.status);
router.post('/upstox/logout',   requireAuth, upstoxCtrl.logout);

module.exports = router;
