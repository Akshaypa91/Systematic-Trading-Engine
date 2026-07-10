// src/middleware/rateLimiter.js
// Per-user rate limiting — authenticated users get their own bucket
// Prevents one heavy user from blocking all others on shared Render IP
'use strict';

const rateLimit = require('express-rate-limit');
const logger    = require('../config/logger');

// Extract real key: userId for authenticated, IP for anonymous
function keyGenerator(req) {
  if (req.user?.userId) return `user:${req.user.userId}`;
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

function onLimitReached(req, res, options) {
  const key = keyGenerator(req);
  logger.warn(`[RateLimit] ${options.message} | key=${key} path=${req.path}`);
}

// ── General API — 200 req / 15 min ───────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              200,
  keyGenerator,
  standardHeaders:  true,
  legacyHeaders:    false,
  handler: (req, res) => {
    onLimitReached(req, res, { message: 'API rate limit reached' });
    res.status(429).json({
      success: false,
      error:   'Too many requests — please slow down',
      retryAfter: Math.ceil(res.getHeader('Retry-After') || 60),
    });
  },
});

// ── Auth — 20 req / 15 min (brute force protection) ──────────────────────────
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    onLimitReached(req, res, { message: 'Auth rate limit reached' });
    res.status(429).json({
      success: false,
      error:   'Too many authentication attempts — try again in 15 minutes',
    });
  },
});

// ── Backtest — 20 req / min (CPU-intensive) ───────────────────────────────────
const backtestLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             20,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    onLimitReached(req, res, { message: 'Backtest rate limit reached' });
    res.status(429).json({
      success: false,
      error:   'Backtest rate limit — max 20 runs per minute',
    });
  },
});

// ── Market data — 150 req / min ───────────────────────────────────────────────
// The dashboard/trade/signals pages legitimately fan out several market-data
// reads. Cheap, high-frequency diagnostics (health, market-status) are exempt so
// status polling can't exhaust the budget meant for quote/price lookups.
const nseProxyLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             parseInt(process.env.MARKET_DATA_RATE_LIMIT || '150', 10),
  keyGenerator,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => /^\/(health|market-status)\b/.test(req.path),
  handler: (req, res) => {
    onLimitReached(req, res, { message: 'Market data rate limit reached' });
    res.status(429).json({ success: false, error: 'Market data rate limit exceeded — please slow down' });
  },
});

module.exports = { apiLimiter, authLimiter, backtestLimiter, nseProxyLimiter };
