// src/portfolio/portfolioState.js — MULTI-USER
// Per-user cache keyed by userId. Falls back to userId=null for anonymous/sim.
'use strict';

const repo   = require('./portfolioRepository');
const logger = require('../config/logger');

const CACHE_TTL_MS = 5000;

// ── Per-user cache ────────────────────────────────────────────────────────────
// Map<userId|null, cacheEntry>
const _caches = new Map();

function _emptyCache() {
  return { portfolioId: null, initialCapital: null, currentCapital: null, positions: null, initialized: false, fetchedAt: 0 };
}

function _get(userId) {
  const key = userId ?? 'anon';
  if (!_caches.has(key)) _caches.set(key, _emptyCache());
  return _caches.get(key);
}

function _invalidate(userId) {
  const c = _get(userId);
  c.positions = null;
  c.fetchedAt = 0;
}

function _isFresh(c) {
  return c.initialized && Date.now() - c.fetchedAt < CACHE_TTL_MS;
}

// ── Hydrate from DB ───────────────────────────────────────────────────────────
async function _hydrate(userId) {
  const c  = _get(userId);
  const pf = await repo.getActivePortfolio(userId);
  if (!pf) {
    Object.assign(c, _emptyCache());
    return false;
  }

  c.portfolioId    = pf.id;
  c.initialCapital = parseFloat(pf.initial_capital);
  c.currentCapital = parseFloat(pf.current_capital);
  c.initialized    = true;
  c.positions      = await repo.getPositions(pf.id);
  c.fetchedAt      = Date.now();
  logger.info(`[Portfolio] Hydrated user=${userId ?? 'anon'} #${pf.id} ₹${c.currentCapital}`);
  return true;
}

// ── Public API — all methods accept optional userId ───────────────────────────

async function initialize(capital, userId = null) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap <= 0) {
    const err = new Error('capital must be a positive number'); err.statusCode = 400; throw err;
  }
  const portfolioId = await repo.createPortfolio(cap, userId);
  const c = _get(userId);
  c.portfolioId    = portfolioId;
  c.initialCapital = parseFloat(cap.toFixed(2));
  c.currentCapital = parseFloat(cap.toFixed(2));
  c.positions      = {};
  c.initialized    = true;
  c.fetchedAt      = Date.now();
}

async function resetToInitial(userId = null) {
  const c = _get(userId);
  if (!c.initialized && !(await _hydrate(userId))) {
    const err = new Error('Portfolio not initialized. Call POST /api/sim/start first.');
    err.statusCode = 400;
    throw err;
  }
  const restoredCapital = await repo.resetPortfolio(c.portfolioId);
  c.currentCapital = restoredCapital;
  c.positions      = {};
  c.fetchedAt      = Date.now();
}

async function getState(userId = null) {
  const c = _get(userId);
  if (!c.initialized) await _hydrate(userId);

  if (c.initialized && !_isFresh(c)) {
    c.positions = await repo.getPositions(c.portfolioId);
    c.fetchedAt = Date.now();
    const pf = await repo.getActivePortfolio(userId);
    if (pf) c.currentCapital = parseFloat(pf.current_capital);
  }

  return {
    capital:        c.initialized ? parseFloat(c.currentCapital.toFixed(2)) : 0,
    initialCapital: c.initialized ? parseFloat(c.initialCapital.toFixed(2)) : 0,
    positions:      c.initialized ? { ...c.positions } : {},
    initialized:    c.initialized,
    portfolioId:    c.portfolioId,
    userId,
  };
}

async function isInitialized(userId = null) {
  const c = _get(userId);
  if (c.initialized) return true;
  return _hydrate(userId);
}

async function executeBuy(symbol, qty, price, priceSource = 'SIM', userId = null) {
  const c = _get(userId);
  if (!c.initialized && !(await _hydrate(userId))) {
    const err = new Error('Portfolio not initialized. Call POST /api/sim/start first.');
    err.statusCode = 400;
    throw err;
  }
  const sym = symbol.toUpperCase();
  const { newCapital, trade } = await repo.saveTrade({ portfolioId: c.portfolioId, symbol: sym, action: 'BUY', qty, price, pnl: null, priceSource });
  c.currentCapital = newCapital;
  _invalidate(userId);
  return { trade: { ...trade, timestamp: trade.executedAt }, capital: newCapital, position: null };
}

async function executeSell(symbol, qty, price, priceSource = 'SIM', userId = null) {
  const c = _get(userId);
  if (!c.initialized && !(await _hydrate(userId))) {
    const err = new Error('Portfolio not initialized. Call POST /api/sim/start first.');
    err.statusCode = 400;
    throw err;
  }
  const sym = symbol.toUpperCase();

  // Verify position
  const pos = (_cache_pos(c, sym)) || (await repo.getPosition(c.portfolioId, sym));
  if (!pos) { const err = new Error(`No open position for ${sym}`); err.statusCode = 400; throw err; }
  if (qty > pos.qty) { const err = new Error(`Cannot sell ${qty} of ${sym} — only ${pos.qty} held`); err.statusCode = 400; throw err; }

  const pnl = parseFloat(((price - pos.entryPrice) * qty).toFixed(2));
  const { newCapital, trade } = await repo.saveTrade({ portfolioId: c.portfolioId, symbol: sym, action: 'SELL', qty, price, pnl, priceSource });
  c.currentCapital = newCapital;
  _invalidate(userId);
  return { trade: { ...trade, timestamp: trade.executedAt }, capital: newCapital, pnl, position: null };
}

function _cache_pos(c, sym) {
  return c.positions?.[sym] || null;
}

function _clearCache(userId = null) {
  _caches.set(userId ?? 'anon', _emptyCache());
}

module.exports = { initialize, resetToInitial, getState, isInitialized, executeBuy, executeSell, _clearCache };
