// src/controllers/upstoxAuthController.js
// ─────────────────────────────────────────────────────────────────────────────
//
// UPSTOX OAUTH CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
//
// Routes (mounted in routes/auth.js):
//   GET  /api/auth/upstox/login     → redirect browser to Upstox OAuth page
//   GET  /api/auth/upstox/callback  → receive code, exchange for token
//   GET  /api/auth/upstox/status    → token status (no token value exposed)
//   POST /api/auth/upstox/logout    → clear token
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const upstoxAuth = require('../services/upstoxAuth');
const upstoxWS   = require('../ws/upstoxWS');
const logger     = require('../config/logger');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── GET /api/auth/upstox/login ────────────────────────────────────────────────

/**
 * Redirect user to Upstox OAuth authorization page.
 * Browser hits this URL; we 302 to Upstox.
 */
function login(req, res) {
  try {
    const url = upstoxAuth.getAuthorizationUrl();
    logger.info('[UpstoxCtrl] Redirecting to Upstox OAuth');
    return res.redirect(302, url);
  } catch (err) {
    logger.error(`[UpstoxCtrl] login error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error:   err.message,
      hint:    'Ensure UPSTOX_API_KEY and UPSTOX_REDIRECT_URI are set in .env',
    });
  }
}

// ── GET /api/auth/upstox/callback ─────────────────────────────────────────────

/**
 * Upstox redirects here after user logs in.
 * Exchange the auth code for an access token, then redirect to frontend.
 *
 * Query params from Upstox:
 *   ?code=<auth_code>   on success
 *   ?error=<message>    on denial / error
 */
async function callback(req, res) {
  const { code, error } = req.query;

  if (error) {
    logger.warn(`[UpstoxCtrl] OAuth denied: ${error}`);
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code) {
    logger.warn('[UpstoxCtrl] Callback received with no code');
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=no_code`);
  }

  try {
    await upstoxAuth.exchangeCodeForToken(code);

    // Start WebSocket connection now that we have a token
    // Non-fatal if it fails — prices fall back to TwelveData/SIM
    try {
      await upstoxWS.connect();
      logger.info('[UpstoxCtrl] Upstox WebSocket connected after OAuth');
    } catch (wsErr) {
      logger.warn(`[UpstoxCtrl] WS connect failed (non-fatal): ${wsErr.message}`);
    }

    // Redirect back to frontend with success flag
    return res.redirect(`${FRONTEND_URL}?upstox=connected`);

  } catch (err) {
    logger.error(`[UpstoxCtrl] Token exchange failed: ${err.message}`);
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=${encodeURIComponent(err.message)}`);
  }
}

// ── GET /api/auth/upstox/status ───────────────────────────────────────────────

/**
 * Returns Upstox auth status.
 * Never exposes the actual token value.
 */
function status(req, res) {
  const tokenStatus = upstoxAuth.getTokenStatus();
  const wsStatus    = upstoxWS.getStatus();

  return res.json({
    success: true,
    upstox: {
      authenticated: upstoxAuth.isAuthenticated(),
      token:         tokenStatus,
      websocket:     wsStatus,
    },
  });
}

// ── POST /api/auth/upstox/logout ──────────────────────────────────────────────

function logout(req, res) {
  upstoxAuth.clearToken();
  upstoxWS.disconnect();
  logger.info('[UpstoxCtrl] Logged out from Upstox');
  return res.json({ success: true, message: 'Upstox session cleared' });
}

module.exports = { login, callback, status, logout };
