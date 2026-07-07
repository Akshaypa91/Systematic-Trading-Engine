// src/middleware/auditLog.js
//
// Writes a row to audit_logs. Built as part of the original security work
// but never actually called from anywhere — wired into auth (signup/login/
// password reset) and live-trading (order/kill-switch/mode) actions.
//
// Fire-and-forget: callers should NOT let this block or fail the response —
// it already swallows its own errors and only warns, so a DB hiccup here
// never breaks the user-facing action it's logging.
'use strict';
const db     = require('../config/database');
const logger = require('../config/logger');

/**
 * @param {string} action    short machine-readable action name, e.g. 'auth.login'
 * @param {object} req       express request (used for ip/user-agent/traceId/user)
 * @param {object} metadata  extra context to store as JSON; pass { userId }
 *                           explicitly for pre-auth actions (signup/login)
 *                           where req.user isn't populated yet.
 */
async function auditLog(action, req, metadata = {}) {
  const { userId: explicitUserId, ...rest } = metadata;
  const userId = explicitUserId ?? req.user?.userId ?? req.user?.id ?? null;
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, ip, user_agent, trace_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        userId,
        action,
        (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').slice(0,45),
        (req.headers['user-agent'] || '').slice(0,255),
        req.traceId || null,
        JSON.stringify(rest),
      ]
    );
    logger.info(`[Audit] ${action}`, { userId, ...rest });
  } catch (err) {
    logger.warn(`[Audit] Write failed: ${err.message}`);
  }
}
module.exports = auditLog;
