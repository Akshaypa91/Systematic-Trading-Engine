// src/middleware/rateLimiter.js — Production Rate Limiting
'use strict';

const rateLimit = require('express-rate-limit');
const logger    = require('../config/logger');

const keyGenerator = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

const onLimitReached = (req, res, options) => {
  logger.warn(`[RateLimit] Hit by ${keyGenerator(req)} on ${req.path}`);
};

// ── General API: 120 req/min per IP ──────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator,
  handler: (req, res) => {
    onLimitReached(req, res);
    res.status(429).json({ success: false, error: 'Too many requests. Please slow down.', retryAfter: 60 });
  },
});

// ── NSE proxy: 30 req/min per IP (mirrors NSE's own rate limit) ──────────────
const nseProxyLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator,
  handler: (req, res) => {
    onLimitReached(req, res);
    res.status(429).json({ success: false, error: 'NSE data rate limit exceeded.', retryAfter: 60 });
  },
});

// ── Auth: 10 req/min per IP (brute-force protection) ─────────────────────────
const authLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator,
  handler: (req, res) => {
    logger.warn(`[RateLimit:Auth] Possible brute-force from ${keyGenerator(req)}`);
    res.status(429).json({ success: false, error: 'Too many auth attempts. Try again in 1 minute.', retryAfter: 60 });
  },
});

// ── Backtest: 20 req/min per IP (POST /api/backtest only — CPU-intensive) ─────
// GET /api/backtest/runs is a cheap DB read, rate-limited by apiLimiter only
const backtestLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             20,
  standardHeaders: true,
  keyGenerator,
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Backtest rate limit: max 20 per minute.', retryAfter: 60 });
  },
});

module.exports = { apiLimiter, nseProxyLimiter, authLimiter, backtestLimiter };
