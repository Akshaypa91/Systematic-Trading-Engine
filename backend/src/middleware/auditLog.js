// src/middleware/auditLog.js
'use strict';
const db     = require('../config/database');
const logger = require('../config/logger');
async function auditLog(action, req, metadata = {}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, ip, user_agent, trace_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        req.user?.userId ?? req.user?.id ?? null,
        action,
        (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').slice(0,45),
        (req.headers['user-agent'] || '').slice(0,255),
        req.traceId || null,
        JSON.stringify(metadata),
      ]
    );
    logger.info(`[Audit] ${action}`, { userId: req.user?.userId ?? req.user?.id, ...metadata });
  } catch (err) {
    logger.warn(`[Audit] Write failed: ${err.message}`);
  }
}
module.exports = auditLog;
