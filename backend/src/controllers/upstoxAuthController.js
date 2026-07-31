// src/controllers/upstoxAuthController.js — HARDENED
'use strict';

const upstoxAuth = require('../services/upstoxAuth');
const upstoxWS   = require('../ws/upstoxWS');
const logger     = require('../config/logger');

// FRONTEND_URL must be a single URL — res.redirect() can't target a
// comma-separated list (unlike ALLOWED_ORIGINS, which is meant to be one).
// Defensive split here so a misconfigured multi-value env var degrades to
// "use the first URL" instead of producing an invalid Location header.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

const userIdOf = (req) => req.user?.userId ?? req.user?.id ?? null;

// ── GET /api/auth/upstox/link (authenticated) ────────────────────────────────
// Returns the Upstox authorize URL with a signed `state` binding the flow to
// the calling user. The frontend then redirects the browser itself.
//
// Why not a plain <a href> to /login: an anchor sends no Authorization header,
// so the backend could not know who was linking. That is exactly how the broker
// session ended up unowned and shared across accounts.
function linkUrl(req, res) {
  try {
    if (!process.env.UPSTOX_API_KEY)      return res.status(500).json({ success: false, error: 'UPSTOX_API_KEY not set' });
    if (!process.env.UPSTOX_REDIRECT_URI) return res.status(500).json({ success: false, error: 'UPSTOX_REDIRECT_URI not set' });
    const userId = userIdOf(req);
    if (userId == null) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const url = upstoxAuth.getAuthorizationUrl(upstoxAuth.signState(userId));
    return res.json({ success: true, url });
  } catch (err) {
    logger.error(`[UpstoxCtrl] linkUrl error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/auth/upstox/login ────────────────────────────────────────────────
// Legacy entry point kept so old bookmarks don't 404. It cannot identify the
// user, so it refuses rather than creating another unowned session.
function login(req, res) {
  logger.info('[UpstoxCtrl] login hit');
  try {
    if (!process.env.UPSTOX_API_KEY)      return res.status(500).json({ success: false, error: 'UPSTOX_API_KEY not set' });
    if (!process.env.UPSTOX_REDIRECT_URI) return res.status(500).json({ success: false, error: 'UPSTOX_REDIRECT_URI not set' });
    logger.warn('[UpstoxCtrl] /upstox/login used — no user context; redirecting to app');
    return res.redirect(302, `${FRONTEND_URL.replace(/\/$/, '')}/trade?upstox=use_app_button`);
  } catch (err) {
    logger.error(`[UpstoxCtrl] login error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/auth/upstox/callback ─────────────────────────────────────────────
async function callback(req, res) {
  logger.info(`[UpstoxCtrl] callback hit — method=${req.method} url=${req.originalUrl}`);
  logger.info(`[UpstoxCtrl] query: ${JSON.stringify(req.query)}`);

  const { code, error, error_description, state } = req.query;

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
    // Who started this link? Signed state, verified — not trusted as given.
    // Without a valid owner the session would be claimable by anyone, which is
    // the bug this whole flow exists to close.
    const ownerUserId = upstoxAuth.verifyState(state);
    if (ownerUserId == null) {
      logger.warn('[UpstoxCtrl] callback with missing/invalid state — refusing to link');
      return res.redirect(`${FRONTEND_URL}?upstox=error&reason=${encodeURIComponent('link expired — start again from the app')}`);
    }

    logger.info(`[UpstoxCtrl] Exchanging code len=${code.length} for user ${ownerUserId}`);
    await upstoxAuth.exchangeCodeForToken(code, ownerUserId);
    logger.info(`[UpstoxCtrl] Token exchange OK — owner=${ownerUserId}`);

    try {
      const s = upstoxWS.getStatus();
      if (!s.connected) {
        await upstoxWS.connect();
        logger.info('[UpstoxCtrl] WS connected post-OAuth');
      }
    } catch (wsErr) {
      logger.warn(`[UpstoxCtrl] WS connect non-fatal: ${wsErr.message}`);
    }

    // Start the reliable REST price poller + warm the instrument master.
    try {
      require('../data/upstoxRestFeed').ensureRunning();
      require('../data/instrumentMaster').load().catch(() => {});
    } catch (e) { logger.warn(`[UpstoxCtrl] REST feed start non-fatal: ${e.message}`); }

    // Land on the Dashboard after connecting — it shows the connected-broker
    // chip, portfolio strip and live signals at a glance.
    return res.redirect(`${FRONTEND_URL.replace(/\/$/, '')}/?upstox=connected`);
  } catch (err) {
    const upstoxBody = err.response?.data;
    logger.error(`[UpstoxCtrl] Token exchange failed: ${err.message} | Upstox response: ${JSON.stringify(upstoxBody)}`);
    return res.redirect(`${FRONTEND_URL}?upstox=error&reason=${encodeURIComponent(err.message)}`);
  }
}

// ── GET /api/auth/upstox/status ───────────────────────────────────────────────
function status(req, res) {
  // "authenticated" must mean "authenticated FOR YOU". Reporting the raw
  // process token here is what made another user's account render as though it
  // were the caller's own.
  const isOwner = upstoxAuth.isOwnedBy(userIdOf(req));
  return res.json({
    success: true,
    upstox: {
      authenticated: isOwner,
      linkedByOther: upstoxAuth.isAuthenticated() && !isOwner,
      token:         isOwner ? upstoxAuth.getTokenStatus() : { hasToken: false },
      websocket:     upstoxWS.getStatus(),
    },
  });
}

// ── POST /api/auth/upstox/logout ──────────────────────────────────────────────
function logout(req, res) {
  // Only the owner may end the session — otherwise any user could disconnect
  // someone else's live broker link mid-session.
  if (upstoxAuth.isAuthenticated() && !upstoxAuth.isOwnedBy(userIdOf(req))) {
    return res.status(403).json({ success: false, error: 'This broker session belongs to another user' });
  }
  upstoxAuth.clearToken();
  upstoxWS.disconnect();
  return res.json({ success: true, message: 'Upstox session cleared' });
}

// ── POST /api/auth/upstox/token ─── manual token injection ───────────────────
function setToken(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  const userId = userIdOf(req);
  if (userId == null) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (upstoxAuth.isAuthenticated() && !upstoxAuth.isOwnedBy(userId)) {
    return res.status(403).json({ success: false, error: 'Another user has an active broker session' });
  }
  // The injector becomes the owner — a manually pasted token is still a real
  // trading credential and needs the same ownership rules as the OAuth path.
  upstoxAuth.setAccessToken(token, null, userId);
  upstoxWS.connect().catch(e => logger.warn(`[UpstoxCtrl] WS: ${e.message}`));
  return res.json({ success: true, message: 'Token set, WS connecting' });
}

module.exports = { login, linkUrl, callback, status, logout, setToken };
