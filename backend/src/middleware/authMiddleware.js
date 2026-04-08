// src/middleware/authMiddleware.js — JWT Authentication Guard
'use strict';

const { verifyJWT } = require('../controllers/authController');
const logger        = require('../config/logger');

/**
 * Protect a route — requires a valid Bearer JWT.
 * Attaches decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyJWT(token);
    next();
  } catch (err) {
    logger.warn(`[Auth] Invalid token from ${req.ip}: ${err.message}`);
    res.status(401).json({ success: false, error: `Authentication failed: ${err.message}` });
  }
}

/**
 * Optional auth — sets req.user if token present, continues if not.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    try { req.user = verifyJWT(authHeader.slice(7)); } catch (_) {}
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
