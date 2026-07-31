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
const crypto = require('crypto');
const logger = require('../config/logger');

// DB is loaded lazily so this module still works in tests / before DB init.
let _db = null;
function db() { if (!_db) { try { _db = require('../config/database'); } catch (_) {} } return _db; }

const UPSTOX_BASE        = 'https://api.upstox.com/v2';
const UPSTOX_AUTH_URL    = 'https://api.upstox.com/v2/login/authorization/dialog';
const UPSTOX_TOKEN_URL   = `${UPSTOX_BASE}/login/authorization/token`;

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY      = process.env.UPSTOX_API_KEY      || '';
const API_SECRET   = process.env.UPSTOX_API_SECRET   || '';
const REDIRECT_URI = process.env.UPSTOX_REDIRECT_URI || '';

// ── Token persistence (survives restarts / shared across instances) ───────────
// Stored in system_flags, AES-256-GCM encrypted with a key derived from an env
// secret so a DB dump never leaks a usable trading token.
const FLAG_TOKEN   = 'upstox.token_enc';
const FLAG_EXPIRES = 'upstox.token_expires';
// WHO connected this broker account. Without it the token is an unowned
// process global: any logged-in user inherited whoever linked Upstox last —
// seeing their real funds and holdings, and able to place real orders on their
// account. Every account-scoped route now checks ownership against this.
const FLAG_OWNER   = 'upstox.token_owner';
const _encKey = crypto.createHash('sha256')
  .update(process.env.UPSTOX_TOKEN_SECRET || process.env.JWT_SECRET || 'systra-dev-token-key')
  .digest();

function _encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _encKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}
function _decrypt(blob) {
  try {
    const [ivH, tagH, dataH] = String(blob).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', _encKey, Buffer.from(ivH, 'hex'));
    decipher.setAuthTag(Buffer.from(tagH, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

// Fire-and-forget upsert into system_flags.
function _persist(token, expiresAt, ownerUserId) {
  const d = db(); if (!d) return;
  const up = (k, v) => d.query(
    `INSERT INTO system_flags (flag_key, flag_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value), updated_at = CURRENT_TIMESTAMP`, [k, v]
  ).catch(e => logger.warn(`[UpstoxAuth] persist ${k}: ${e.message}`));
  up(FLAG_TOKEN, _encrypt(token));
  up(FLAG_EXPIRES, String(expiresAt || ''));
  up(FLAG_OWNER, ownerUserId == null ? '' : String(ownerUserId));
}
function _clearPersisted() {
  const d = db(); if (!d) return;
  d.query(`DELETE FROM system_flags WHERE flag_key IN (?, ?, ?)`, [FLAG_TOKEN, FLAG_EXPIRES, FLAG_OWNER])
    .catch(e => logger.warn(`[UpstoxAuth] clear persisted: ${e.message}`));
}

/**
 * Restore a persisted token into memory at boot. Called from app.js before the
 * Upstox WS connect. Ignores expired tokens.
 */
async function loadPersistedToken() {
  const d = db(); if (!d) return false;
  try {
    const [rows] = await d.query(`SELECT flag_key, flag_value FROM system_flags WHERE flag_key IN (?, ?, ?)`, [FLAG_TOKEN, FLAG_EXPIRES, FLAG_OWNER]);
    const map = Object.fromEntries(rows.map(r => [r.flag_key, r.flag_value]));
    const enc = map[FLAG_TOKEN];
    if (!enc) return false;
    const token = _decrypt(enc);
    const expiresAt = Number(map[FLAG_EXPIRES]) || _endOfDayIST();
    if (!token || Date.now() > expiresAt) { _clearPersisted(); return false; }
    // A token persisted before ownership tracking existed has no owner. It stays
    // usable for market data but no user can claim it for account access —
    // failing closed is correct when we cannot prove who it belongs to.
    _token = { accessToken: token, tokenType: 'Bearer', expiresAt, grantedAt: Date.now(),
               ownerUserId: _coerceUserId(map[FLAG_OWNER]) };
    logger.info(`[UpstoxAuth] Restored persisted token (expires ${new Date(expiresAt).toISOString()}, owner=${_token.ownerUserId ?? 'unknown'})`);
    return true;
  } catch (err) {
    logger.warn(`[UpstoxAuth] loadPersistedToken failed: ${err.message}`);
    return false;
  }
}

// ── In-memory token store ─────────────────────────────────────────────────────
// One broker session per deployment, but it now carries an OWNER. The token
// itself stays shared because market data (prices, candles, indices) is not
// user-specific and background jobs have no request context — but anything that
// touches the linked account (funds, holdings, positions, orders) is gated on
// `ownerUserId` by requireBrokerOwner.

let _token = {
  accessToken:  process.env.UPSTOX_ACCESS_TOKEN || null,
  tokenType:    'Bearer',
  // An env-provided token has no known issue time. Upstox tokens die at ~3:30am
  // IST, so cap its life at the next IST day boundary — otherwise a stale token
  // left in the env var reads as "valid forever" and 401s every request.
  expiresAt:    process.env.UPSTOX_ACCESS_TOKEN ? _endOfDayIST() : null,
  grantedAt:    null,
  // null = nobody has claimed this session (env-injected or pre-upgrade token).
  // Deliberately not "everybody": unowned means no user gets account access.
  ownerUserId:  null,
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
function setAccessToken(accessToken, expiresInSeconds, ownerUserId = null) {
  _token.accessToken = accessToken;
  _token.grantedAt   = Date.now();
  // Careful: Number(null) and Number('') are both 0, and Number.isFinite(0) is
  // true — a naive coercion turns "no owner" into "user 0" and hands an unowned
  // token a valid-looking owner. Reject the empty cases explicitly first.
  _token.ownerUserId = _coerceUserId(ownerUserId);
  _token.expiresAt   = expiresInSeconds
    ? Date.now() + expiresInSeconds * 1000
    : _endOfDayIST();   // Upstox tokens expire at midnight IST
  _persist(_token.accessToken, _token.expiresAt, _token.ownerUserId);   // survive restarts
  logger.info(`[UpstoxAuth] Access token set — expires at ${new Date(_token.expiresAt).toISOString()}, owner=${_token.ownerUserId ?? 'unknown'}`);
}

/**
 * Clear the stored token (logout / manual revoke).
 */
function clearToken() {
  _token = { accessToken: null, tokenType: 'Bearer', expiresAt: null, grantedAt: null, ownerUserId: null };
  _clearPersisted();
  logger.info('[UpstoxAuth] Token cleared');
}

// ── OAuth `state` signing ─────────────────────────────────────────────────────
// HMAC over "userId.issuedAtMs" with a 10-minute window. Enough to bind the
// callback to the user who began the flow and to stop replay.
const STATE_TTL_MS = 10 * 60 * 1000;

function signState(userId) {
  if (userId == null) return null;
  const payload = `${userId}.${Date.now()}`;
  const mac = crypto.createHmac('sha256', _encKey).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${payload}.${mac}`).toString('base64url');
}

/** @returns {number|null} the user id encoded in `state`, or null if invalid/expired. */
function verifyState(state) {
  try {
    if (!state) return null;
    const raw = Buffer.from(String(state), 'base64url').toString('utf8');
    const [uid, ts, mac] = raw.split('.');
    if (!uid || !ts || !mac) return null;
    const expected = crypto.createHmac('sha256', _encKey).update(`${uid}.${ts}`).digest('hex').slice(0, 32);
    // timingSafeEqual needs equal lengths; the slice above guarantees that.
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    if (Date.now() - Number(ts) > STATE_TTL_MS) return null;
    const n = Number(uid);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** Normalise a user id to a positive integer, or null. Never 0. */
function _coerceUserId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The user id that linked this broker session, or null if unknown. */
function getOwnerUserId() {
  return _token.accessToken ? (_token.ownerUserId ?? null) : null;
}

/**
 * Is `userId` allowed to act on the linked broker account?
 * Fail-closed: no token, or a token with no recorded owner, means no.
 */
function isOwnedBy(userId) {
  const owner = getOwnerUserId();
  const asked = _coerceUserId(userId);
  if (owner == null || asked == null) return false;
  return owner === asked;
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
    ownerUserId: _token.ownerUserId ?? null,
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
function getAuthorizationUrl(state = null) {
  if (!API_KEY)      throw new Error('UPSTOX_API_KEY not configured');
  if (!REDIRECT_URI) throw new Error('UPSTOX_REDIRECT_URI not configured');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     API_KEY,
    redirect_uri:  REDIRECT_URI,
  });
  // `state` carries a signed record of WHICH user started this link, because
  // Upstox calls the callback from the user's browser with no auth header of
  // ours. Signed (not a raw user id) so the callback can't be forged into
  // assigning someone else's broker session.
  if (state) params.set('state', state);

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
async function exchangeCodeForToken(code, ownerUserId = null) {
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

  setAccessToken(accessToken, expiresIn, ownerUserId);

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
  getOwnerUserId,
  isOwnedBy,
  signState,
  verifyState,
  getTokenStatus,
  getAuthorizationUrl,
  exchangeCodeForToken,
  loadPersistedToken,
  // Config exposure for WS module
  UPSTOX_BASE,
  API_KEY,
};
