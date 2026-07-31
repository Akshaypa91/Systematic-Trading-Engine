// src/middleware/brokerOwner.js
// ─────────────────────────────────────────────────────────────────────────────
// Guards every route that touches the LINKED BROKER ACCOUNT — funds, holdings,
// positions, order book, order placement, exits, cancels.
//
// Why this exists: the Upstox access token is a single process-wide value. It
// had no recorded owner, and the live routes only checked `requireAuth` —
// "is somebody logged in", not "is this THEIR account". The result was that any
// registered user saw the funds and holdings of whoever linked Upstox last, and
// POST /api/live/order would place a REAL order on that person's account. Two
// different logins rendering the same client ID and the same ₹ balance is what
// surfaced it.
//
// requireAuth answers authentication. This answers authorisation, and they are
// not the same question.
//
// Fail-closed by construction: no token, an unowned token (env-injected or
// persisted before ownership tracking existed), or a mismatched user all return
// 403. Market-data routes are deliberately NOT gated — prices are not account
// data, and background jobs have no request context.
'use strict';

const upstoxAuth = require('../services/upstoxAuth');
const logger     = require('../config/logger');

const userIdOf = (req) => req.user?.userId ?? req.user?.id ?? null;

function requireBrokerOwner(req, res, next) {
  const userId = userIdOf(req);

  if (!upstoxAuth.isAuthenticated()) {
    return res.status(409).json({
      success: false,
      error:   'BROKER_NOT_CONNECTED',
      message: 'Connect your Upstox account to use this feature.',
    });
  }

  if (!upstoxAuth.isOwnedBy(userId)) {
    // Logged loud: in a real deployment this is either a misconfiguration or
    // somebody probing another user's account.
    logger.warn(`[BrokerOwner] DENY user=${userId} → broker owner=${upstoxAuth.getOwnerUserId() ?? 'unknown'} on ${req.method} ${req.originalUrl}`);
    return res.status(403).json({
      success: false,
      error:   'BROKER_NOT_YOURS',
      message: 'This broker session belongs to a different account. Connect your own Upstox account to trade.',
    });
  }

  return next();
}

module.exports = { requireBrokerOwner };
