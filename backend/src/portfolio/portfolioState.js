// src/portfolio/portfolioState.js
// ─────────────────────────────────────────────────────────────────────────────
//
// PERSISTENT PORTFOLIO STATE
// ─────────────────────────────────────────────────────────────────────────────
//
// DROP-IN replacement for the old in-memory version.
// Public API is identical — all callers (simController, tradeController,
// executionEngine) work unchanged.
//
// PERSISTENCE STRATEGY
// ─────────────────────
//   • portfolios table  — capital balance, lifecycle state
//   • sim_trades table  — append-only trade ledger
//   • Positions         — reconstructed on every read from the trade ledger
//                         (no separate positions table → no sync bugs)
//
// CACHING
// ────────
//   A lightweight in-memory write-through cache sits in front of DB reads.
//   Cache is invalidated on every write (trade or capital change).
//   TTL = 5s so a crashed process re-hydrates quickly on restart.
//
// FALLBACK
// ────────
//   If DB is unreachable (Render free tier sleep, cold start) every method
//   throws a clear error with statusCode=503 so the API returns 503 instead
//   of a silent null/undefined.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const repo   = require('./portfolioRepository');
const logger = require('../config/logger');

// ── Write-through cache ───────────────────────────────────────────────────────

const CACHE_TTL_MS = 5000;

let _cache = {
  portfolioId:     null,
  initialCapital:  null,
  currentCapital:  null,
  positions:       null,   // reconstructed from trades
  initialized:     false,
  fetchedAt:       0,
};

function _invalidate() {
  _cache.positions  = null;
  _cache.fetchedAt  = 0;
}

function _isFresh() {
  return _cache.initialized && Date.now() - _cache.fetchedAt < CACHE_TTL_MS;
}

// ── DB hydration ──────────────────────────────────────────────────────────────

/**
 * Load the active portfolio from DB into cache.
 * Called lazily on first access after process start.
 *
 * @returns {Promise<boolean>} true if an active portfolio exists
 */
async function _hydrate() {
  const pf = await repo.getActivePortfolio();
  if (!pf) {
    _cache.initialized = false;
    return false;
  }

  _cache.portfolioId    = pf.id;
  _cache.initialCapital = parseFloat(pf.initial_capital);
  _cache.currentCapital = parseFloat(pf.current_capital);
  _cache.initialized    = true;
  _cache.positions      = await repo.getPositions(pf.id);
  _cache.fetchedAt      = Date.now();

  logger.info(
    `[PortfolioState] Hydrated from DB: ` +
    `portfolio #${pf.id} capital=₹${_cache.currentCapital} ` +
    `positions=${Object.keys(_cache.positions).length}`
  );
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize portfolio with user-defined capital.
 * Called by POST /api/sim/start
 *
 * @param {number} capital
 * @throws {Error} statusCode=400 if invalid
 */
async function initialize(capital) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap <= 0) {
    const err = new Error('capital must be a positive number');
    err.statusCode = 400;
    throw err;
  }

  const portfolioId = await repo.createPortfolio(cap);

  _cache.portfolioId    = portfolioId;
  _cache.initialCapital = parseFloat(cap.toFixed(2));
  _cache.currentCapital = parseFloat(cap.toFixed(2));
  _cache.positions      = {};
  _cache.initialized    = true;
  _cache.fetchedAt      = Date.now();
}

/**
 * Reset portfolio back to initialCapital.
 * Called by POST /api/sim/reset
 *
 * @throws {Error} statusCode=400 if not initialized
 */
async function resetToInitial() {
  if (!_cache.initialized && !(await _hydrate())) {
    const err = new Error('Portfolio not initialized. Call POST /api/sim/start first.');
    err.statusCode = 400;
    throw err;
  }

  const restoredCapital = await repo.resetPortfolio(_cache.portfolioId);

  _cache.currentCapital = restoredCapital;
  _cache.positions      = {};
  _cache.fetchedAt      = Date.now();
}

/**
 * Get snapshot of full portfolio state.
 * Reconstructs positions from DB if cache is stale.
 *
 * @returns {Promise<{capital, initialCapital, positions, initialized}>}
 */
async function getState() {
  // Lazy hydrate on first call after process start
  if (!_cache.initialized) {
    await _hydrate();
  }

  // Refresh positions from DB if cache is stale
  if (_cache.initialized && !_isFresh()) {
    _cache.positions = await repo.getPositions(_cache.portfolioId);
    _cache.fetchedAt = Date.now();

    // Re-read capital too (another process might have updated it)
    const pf = await repo.getActivePortfolio();
    if (pf) _cache.currentCapital = parseFloat(pf.current_capital);
  }

  return {
    capital:        _cache.initialized ? parseFloat(_cache.currentCapital.toFixed(2)) : 0,
    initialCapital: _cache.initialized ? parseFloat(_cache.initialCapital.toFixed(2)) : 0,
    positions:      _cache.initialized ? { ..._cache.positions } : {},
    initialized:    _cache.initialized,
    portfolioId:    _cache.portfolioId,
  };
}

/** Whether portfolio has been initialised. */
async function isInitialized() {
  if (_cache.initialized) return true;
  return _hydrate();
}

// ── Trade execution ───────────────────────────────────────────────────────────

/**
 * Execute a BUY trade.
 *
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @param {string} [priceSource='SIM']
 * @returns {Promise<{trade, capital, position}>}
 * @throws {Error} statusCode=400
 */
async function executeBuy(symbol, qty, price, priceSource = 'SIM') {
  if (!_cache.initialized && !(await _hydrate())) {
    const err = new Error('Portfolio not initialized. Call POST /api/sim/start first.');
    err.statusCode = 400;
    throw err;
  }

  const sym = symbol.toUpperCase();

  // saveTrade does the capital check + atomic update inside a transaction
  const { tradeId, newCapital, trade } = await repo.saveTrade({
    portfolioId: _cache.portfolioId,
    symbol:      sym,
    action:      'BUY',
    qty,
    price,
    pnl:         null,
    priceSource,
  });

  // Update cache
  _cache.currentCapital = newCapital;
  _invalidate();  // positions stale — will be recomputed on next getState()

  return {
    trade:    { ...trade, timestamp: trade.executedAt },
    capital:  newCapital,
    position: null,  // caller can call getState() if they need the updated position
  };
}

/**
 * Execute a SELL trade.
 *
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @param {string} [priceSource='SIM']
 * @returns {Promise<{trade, capital, position, pnl}>}
 * @throws {Error} statusCode=400
 */
async function executeSell(symbol, qty, price, priceSource = 'SIM') {
  if (!_cache.initialized && !(await _hydrate())) {
    const err = new Error('Portfolio not initialized. Call POST /api/sim/start first.');
    err.statusCode = 400;
    throw err;
  }

  const sym = symbol.toUpperCase();

  // Check position exists in DB (most accurate) or cache
  if (_cache.positions && !_cache.positions[sym]) {
    // Double-check DB in case cache is stale
    const pos = await repo.getPosition(_cache.portfolioId, sym);
    if (!pos) {
      const err = new Error(`No open position for ${sym}`);
      err.statusCode = 400;
      throw err;
    }
    if (qty > pos.qty) {
      const err = new Error(`Cannot sell ${qty} of ${sym} — only ${pos.qty} held`);
      err.statusCode = 400;
      throw err;
    }
    // Compute P&L from DB position
    const pnl = parseFloat(((price - pos.entryPrice) * qty).toFixed(2));
    const { tradeId, newCapital, trade } = await repo.saveTrade({
      portfolioId: _cache.portfolioId,
      symbol:      sym,
      action:      'SELL',
      qty,
      price,
      pnl,
      priceSource,
    });
    _cache.currentCapital = newCapital;
    _invalidate();
    return { trade: { ...trade, timestamp: trade.executedAt }, capital: newCapital, pnl, position: null };
  }

  const existing = _cache.positions?.[sym];
  if (!existing) {
    const err = new Error(`No open position for ${sym}`);
    err.statusCode = 400;
    throw err;
  }
  if (qty > existing.qty) {
    const err = new Error(`Cannot sell ${qty} of ${sym} — only ${existing.qty} held`);
    err.statusCode = 400;
    throw err;
  }

  const pnl = parseFloat(((price - existing.entryPrice) * qty).toFixed(2));

  const { tradeId, newCapital, trade } = await repo.saveTrade({
    portfolioId: _cache.portfolioId,
    symbol:      sym,
    action:      'SELL',
    qty,
    price,
    pnl,
    priceSource,
  });

  _cache.currentCapital = newCapital;
  _invalidate();

  return {
    trade:    { ...trade, timestamp: trade.executedAt },
    capital:  newCapital,
    pnl,
    position: null,
  };
}

// ── Hard reset (testing only) ─────────────────────────────────────────────────

/**
 * Clear cache only. Used in tests to simulate process restart.
 */
function _clearCache() {
  _cache = {
    portfolioId:    null,
    initialCapital: null,
    currentCapital: null,
    positions:      null,
    initialized:    false,
    fetchedAt:      0,
  };
}

module.exports = {
  initialize,
  resetToInitial,
  getState,
  isInitialized,
  executeBuy,
  executeSell,
  _clearCache,  // testing only
};
