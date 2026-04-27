// src/services/upstoxAuth.js
// ─────────────────────────────────────────────────────────────────────────────
//
// UPSTOX OAUTH TOKEN STORE
// ─────────────────────────────────────────────────────────────────────────────
//
// Handles:
//   • Building the OAuth authorization URL
//   • Exchanging auth code for access token
//   • Storing / reading the access token (in-memory + .env fallback)
//   • Refreshing the token (Upstox tokens last 1 trading day)
//
// ENV VARS REQUIRED:
//   UPSTOX_API_KEY       — Client ID from Upstox developer console
//   UPSTOX_API_SECRET    — Client Secret from Upstox developer console
//   UPSTOX_REDIRECT_URI  — Must match what you registered in Upstox console
//                          e.g. https://systra.onrender.com/api/auth/upstox/callback
//
// OPTIONAL:
//   UPSTOX_ACCESS_TOKEN  — Pre-set a token (useful for testing / server restart)
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const axios  = require('axios');
const logger = require('../config/logger');

const UPSTOX_BASE        = 'https://api.upstox.com/v2';
const UPSTOX_AUTH_URL    = 'https://api.upstox.com/v2/login/authorization/dialog';
const UPSTOX_TOKEN_URL   = `${UPSTOX_BASE}/login/authorization/token`;

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY      = process.env.UPSTOX_API_KEY      || '';
const API_SECRET   = process.env.UPSTOX_API_SECRET   || '';
const REDIRECT_URI = process.env.UPSTOX_REDIRECT_URI || '';

// ── In-memory token store (single-user mode) ──────────────────────────────────
// For multi-user: store in DB keyed by user_id instead

let _token = {
  accessToken:  process.env.UPSTOX_ACCESS_TOKEN || null,
  tokenType:    'Bearer',
  expiresAt:    null,   // epoch ms, null = unknown
  grantedAt:    null,
};

// ── Public token API ──────────────────────────────────────────────────────────

/**
 * Get the current access token, or null if not authenticated.
 * @returns {string|null}
 */
function getAccessToken() {
  if (!_token.accessToken) return null;
  // Upstox tokens expire at EOD IST — if we know expiry and it's past, clear it
  if (_token.expiresAt && Date.now() > _token.expiresAt) {
    logger.warn('[UpstoxAuth] Access token expired — clearing');
    _token.accessToken = null;
    return null;
  }
  return _token.accessToken;
}

/**
 * Set the access token (called after successful OAuth exchange).
 * @param {string} accessToken
 * @param {number} [expiresInSeconds]
 */
function setAccessToken(accessToken, expiresInSeconds) {
  _token.accessToken = accessToken;
  _token.grantedAt   = Date.now();
  _token.expiresAt   = expiresInSeconds
    ? Date.now() + expiresInSeconds * 1000
    : _endOfDayIST();   // Upstox tokens expire at midnight IST
  logger.info(`[UpstoxAuth] Access token set — expires at ${new Date(_token.expiresAt).toISOString()}`);
}

/**
 * Clear the stored token (logout / manual revoke).
 */
function clearToken() {
  _token = { accessToken: null, tokenType: 'Bearer', expiresAt: null, grantedAt: null };
  logger.info('[UpstoxAuth] Token cleared');
}

/**
 * Check whether we have a valid (non-expired) token.
 * @returns {boolean}
 */
function isAuthenticated() {
  return getAccessToken() !== null;
}

/**
 * Get token metadata for debug/status endpoints.
 */
function getTokenStatus() {
  return {
    hasToken:    !!_token.accessToken,
    grantedAt:   _token.grantedAt ? new Date(_token.grantedAt).toISOString() : null,
    expiresAt:   _token.expiresAt  ? new Date(_token.expiresAt).toISOString()  : null,
    isExpired:   _token.expiresAt  ? Date.now() > _token.expiresAt  : false,
  };
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

/**
 * Build the Upstox OAuth authorization URL.
 * Redirect user to this URL to start the login flow.
 *
 * @returns {string}  Full authorization URL
 * @throws  {Error}   If API_KEY or REDIRECT_URI not configured
 */
function getAuthorizationUrl() {
  if (!API_KEY)      throw new Error('UPSTOX_API_KEY not configured');
  if (!REDIRECT_URI) throw new Error('UPSTOX_REDIRECT_URI not configured');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     API_KEY,
    redirect_uri:  REDIRECT_URI,
  });

  const url = `${UPSTOX_AUTH_URL}?${params.toString()}`;
  logger.info(`[UpstoxAuth] Authorization URL built: ${url}`);
  return url;
}

/**
 * Exchange an authorization code for an access token.
 * Called in the OAuth callback handler.
 *
 * @param {string} code  Authorization code from Upstox callback
 * @returns {Promise<{ accessToken, expiresIn }>}
 * @throws on network error or Upstox API error
 */
async function exchangeCodeForToken(code) {
  if (!API_KEY)      throw new Error('UPSTOX_API_KEY not configured');
  if (!API_SECRET)   throw new Error('UPSTOX_API_SECRET not configured');
  if (!REDIRECT_URI) throw new Error('UPSTOX_REDIRECT_URI not configured');
  if (!code)         throw new Error('Authorization code is required');

  logger.info('[UpstoxAuth] Exchanging auth code for access token…');
  logger.debug(`[UpstoxAuth] Using client_id=${API_KEY} secret_len=${API_SECRET.length} redirect=${REDIRECT_URI}`);

  const response = await axios.post(
    UPSTOX_TOKEN_URL,
    new URLSearchParams({
      code,
      client_id:     API_KEY,
      client_secret: API_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':       'application/json',
      },
      timeout: 10_000,
    }
  );

  const data = response.data;

  if (!data.access_token) {
    throw new Error(`Upstox token exchange failed: ${JSON.stringify(data)}`);
  }

  const accessToken  = data.access_token;
  const expiresIn    = data.expires_in ?? null;

  setAccessToken(accessToken, expiresIn);

  logger.info('[UpstoxAuth] ✅ Token exchange successful');
  return { accessToken, expiresIn };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns epoch ms for midnight IST today (Upstox token expiry). */
function _endOfDayIST() {
  const now    = new Date();
  const ist    = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const endIST = new Date(ist);
  endIST.setUTCHours(18, 30, 0, 0);   // 18:30 UTC = midnight IST
  if (endIST <= now) endIST.setUTCDate(endIST.getUTCDate() + 1);
  return endIST.getTime();
}

module.exports = {
  getAccessToken,
  setAccessToken,
  clearToken,
  isAuthenticated,
  getTokenStatus,
  getAuthorizationUrl,
  exchangeCodeForToken,
  // Config exposure for WS module
  UPSTOX_BASE,
  API_KEY,
};
