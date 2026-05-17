// src/middleware/auditLog.js
// Usage: await auditLog('LOGIN', req, { email, provider })
'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

// DB table required:
// CREATE TABLE IF NOT EXISTS audit_logs (
//   id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
//   user_id    INT UNSIGNED NULL,
//   action     VARCHAR(60)  NOT NULL,
//   ip         VARCHAR(45)  NULL,
//   user_agent VARCHAR(255) NULL,
//   trace_id   VARCHAR(36)  NULL,
//   metadata   JSON         NULL,
//   created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   INDEX idx_user    (user_id),
//   INDEX idx_action  (action),
//   INDEX idx_created (created_at DESC)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

const AUDITED_ACTIONS = new Set([
  'LOGIN', 'LOGOUT', 'SIGNUP',
  'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_COMPLETE',
  'LIVE_ORDER_PLACED', 'LIVE_ORDER_REJECTED',
  'TRADING_MODE_CHANGE', 'UPSTOX_CONNECTED',
  'KILL_SWITCH_TOGGLED', 'ADMIN_ACTION',
]);

async function auditLog(action, req, metadata = {}) {
  if (!AUDITED_ACTIONS.has(action)) {
    logger.debug(`[Audit] Skipping unenumerated action: ${action}`);
  }

  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, ip, user_agent, trace_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        req.user?.userId ?? null,
        action,
        (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').slice(0, 45),
        (req.headers['user-agent'] || '').slice(0, 255),
        req.traceId || null,
        JSON.stringify(metadata),
      ]
    );
    logger.info(`[Audit] ${action}`, { userId: req.user?.userId, traceId: req.traceId, ...metadata });
  } catch (err) {
    // Non-fatal — never block request for audit failure
    logger.warn(`[Audit] Write failed: ${err.message}`);
  }
}

module.exports = auditLog;
