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

// ── General API — 600 req / 15 min (env: API_RATE_LIMIT) ─────────────────────
// The SPA legitimately polls health/market-status and fans out market-data reads
// on several pages, so the anonymous per-IP budget must be generous. Critically,
// AUTH and the cheap status polls are EXEMPT here: auth has its own dedicated
// brute-force limiter (authLimiter), and login must never be blocked just
// because background polling exhausted the general bucket.
const apiLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              parseInt(process.env.API_RATE_LIMIT || '600', 10),
  keyGenerator,
  standardHeaders:  true,
  legacyHeaders:    false,
  skip: (req) => /^\/auth\b/.test(req.path)                       // /api/auth/* → authLimiter only
    || /^\/(health|__debug)\b/.test(req.path)
    || /\/(health|market-status)\b/.test(req.path),               // cheap status polls
  handler: (req, res) => {
    onLimitReached(req, res, { message: 'API rate limit reached' });
    res.status(429).json({
      success: false,
      error:   'Too many requests — please slow down',
      retryAfter: Math.ceil(res.getHeader('Retry-After') || 60),
    });
  },
});

// ── Auth — 40 req / 15 min (brute-force protection; env: AUTH_RATE_LIMIT) ─────
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             parseInt(process.env.AUTH_RATE_LIMIT || '40', 10),
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
