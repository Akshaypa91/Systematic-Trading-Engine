// src/middleware/errorHandler.js — Centralised Error Handling
'use strict';

const logger = require('../config/logger');

// ── Standard API error response ───────────────────────────────────────────────
function errorHandler(err, req, res, next) {
  // Don't leak internal details in production
  const status  = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  logger.error(`[HTTP ${status}] ${req.method} ${req.path} — ${err.message}`, {
    method: req.method, path: req.path, status,
    ip: req.ip, userAgent: req.get('User-Agent'),
    ...(status >= 500 && { stack: err.stack }),
  });

  res.status(status).json({
    success: false,
    error:   message,
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message, stack: err.stack }),
  });
}

// ── 404 handler ───────────────────────────────────────────────────────────────
function notFound(req, res) {
  res.status(404).json({
    success: false,
    error:   `Route not found: ${req.method} ${req.path}`,
  });
}

// ── Input validation helper ───────────────────────────────────────────────────
/**
 * Validate request body fields.
 * Usage: validateBody(['symbol', 'strategy'])(req, res, next)
 *
 * @param {string[]} required   required field names
 * @param {Object}   rules      optional: { fieldName: (value) => true|'error message' }
 */
function validateBody(required = [], rules = {}) {
  return (req, res, next) => {
    const missing = required.filter(f => req.body[f] == null || req.body[f] === '');
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error:   `Missing required fields: ${missing.join(', ')}`,
      });
    }
    for (const [field, validator] of Object.entries(rules)) {
      const result = validator(req.body[field]);
      if (result !== true) {
        return res.status(400).json({ success: false, error: result });
      }
    }
    next();
  };
}

/**
 * Validate query params.
 */
function validateQuery(required = [], rules = {}) {
  return (req, res, next) => {
    const missing = required.filter(f => req.query[f] == null || req.query[f] === '');
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error:   `Missing required query params: ${missing.join(', ')}`,
      });
    }
    for (const [field, validator] of Object.entries(rules)) {
      const result = validator(req.query[field]);
      if (result !== true) {
        return res.status(400).json({ success: false, error: result });
      }
    }
    next();
  };
}

/**
 * Wrap an async route handler so errors are forwarded to errorHandler.
 * Eliminates try/catch boilerplate in every controller.
 *
 * Usage:  router.get('/path', asyncHandler(ctrl.myFn))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, notFound, validateBody, validateQuery, asyncHandler };
