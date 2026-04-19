// src/controllers/upstoxAuthController.js — HARDENED
'use strict';

const upstoxAuth = require('../services/upstoxAuth');
const upstoxWS   = require('../ws/upstoxWS');
const logger     = require('../config/logger');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── GET /api/auth/upstox/login ────────────────────────────────────────────────
function login(req, res) {
  logger.info('[UpstoxCtrl] login hit');
  try {
    if (!process.env.UPSTOX_API_KEY)      return res.status(500).json({ success: false, error: 'UPSTOX_API_KEY not set' });
    if (!process.env.UPSTOX_REDIRECT_URI) return res.status(500).json({ success: false, error: 'UPSTOX_REDIRECT_URI not set' });
    const url = upstoxAuth.getAuthorizationUrl();
    logger.info(`[UpstoxCtrl] Redirecting → ${url}`);
    return res.redirect(302, url);
  } catch (err) {
    logger.error(`[UpstoxCtrl] login error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/auth/upstox/callback ─────────────────────────────────────────────
async function callback(req, res) {
  logger.info(`[UpstoxCtrl] callback hit — method=${req.method} url=${req.originalUrl}`);
  logger.info(`[UpstoxCtrl] query: ${JSON.stringify(req.query)}`);

  const { code, error, error_description } = req.query;

  if (error) {
    const reason = error_description || error;
    logger.warn(`[UpstoxCtrl] OAuth denied: ${reason}`);
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=${encodeURIComponent(reason)}`);
  }

  if (!code) {
    logger.warn('[UpstoxCtrl] No code in callback — redirect_uri mismatch?');
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=no_code`);
  }

  try {
    logger.info(`[UpstoxCtrl] Exchanging code len=${code.length}`);
    await upstoxAuth.exchangeCodeForToken(code);
    logger.info('[UpstoxCtrl] Token exchange OK');

    try {
      const s = upstoxWS.getStatus();
      if (!s.connected) {
        await upstoxWS.connect();
        logger.info('[UpstoxCtrl] WS connected post-OAuth');
      }
    } catch (wsErr) {
      logger.warn(`[UpstoxCtrl] WS connect non-fatal: ${wsErr.message}`);
    }

    return res.redirect(`${FRONTEND_URL}?upstox=connected`);
  } catch (err) {
    logger.error(`[UpstoxCtrl] Token exchange failed: ${err.message}`);
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=${encodeURIComponent(err.message)}`);
  }
}

// ── GET /api/auth/upstox/status ───────────────────────────────────────────────
function status(req, res) {
  return res.json({
    success: true,
    upstox: {
      authenticated: upstoxAuth.isAuthenticated(),
      token:         upstoxAuth.getTokenStatus(),
      websocket:     upstoxWS.getStatus(),
    },
  });
}

// ── POST /api/auth/upstox/logout ──────────────────────────────────────────────
function logout(req, res) {
  upstoxAuth.clearToken();
  upstoxWS.disconnect();
  return res.json({ success: true, message: 'Upstox session cleared' });
}

// ── POST /api/auth/upstox/token ─── manual token injection ───────────────────
function setToken(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  upstoxAuth.setAccessToken(token);
  upstoxWS.connect().catch(e => logger.warn(`[UpstoxCtrl] WS: ${e.message}`));
  return res.json({ success: true, message: 'Token set, WS connecting' });
}

module.exports = { login, callback, status, logout, setToken };
