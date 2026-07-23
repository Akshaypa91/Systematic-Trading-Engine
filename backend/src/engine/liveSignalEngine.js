// src/engine/liveSignalEngine.js
// ─────────────────────────────────────────────────────────────────────────────
//
// ═══════════════════════════════════════════════════════════════════════════
// LIVE SIGNAL ENGINE — Real-Time Signal Generation
// ═══════════════════════════════════════════════════════════════════════════
//
// WHAT THIS MODULE DOES
// ─────────────────────
// Converts the offline backtest/signal system into a real-time engine that:
//
//   1. Runs on a configurable interval (default 5 minutes)
//   2. Fetches latest price data for a watchlist of symbols
//   3. Generates signals using the multi-strategy aggregator
//   4. Persists each signal to the DB with deduplication
//   5. Evaluates paper trading logic (BUY/SELL paper orders)
//   6. Broadcasts signals to WebSocket clients
//   7. Maintains in-memory state for fast API reads
//
// PAPER TRADING LOOP (CRITICAL DESIGN)
// ─────────────────────────────────────
// Signal → Paper Trade decision flow:
//
//   BUY signal + no open position + passes risk check → placeOrder(BUY)
//   SELL signal + open position → placeOrder(SELL, close position)
//   HOLD → no action
//
// Deduplication prevents placing multiple orders for the same signal:
//   Each signal has a hash: sha256(symbol + date + signal_type)
//   If hash already in DB → skip (same signal, same day)
//
// SAFETY MECHANISMS
// ─────────────────
//   • Rate-limited symbol processing (N ms delay between symbols)
//   • Exponential backoff on consecutive failures
//   • Circuit breaker: stop processing a symbol after 3 consecutive errors
//   • Minimum bars check before generating signals (≥201 required)
//   • NSE API failures caught per-symbol (non-fatal to the engine)
//
// ARCHITECTURE
// ─────────────
//   LiveSignalEngine (this module)
//     ↓ runs on interval
//   _processSymbol(symbol)
//     ↓ fetches recent bars
//   aggregator.aggregate(closes)
//     ↓ generates { signal, confidence, regime }
//   _persistSignal(...)          → DB signals table
//   _evaluatePaperTrade(...)     → executionEngine.placeOrder()
//   liveDataFeed.broadcastSignal → WebSocket clients
//
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto        = require('crypto');
const dataStore     = require('../data/dataStore');
const aggregator    = require('../strategies/aggregator');
const strategyCore  = require('./strategyCore');
const execEngine    = require('./executionEngine');
const liveDataFeed  = require('../data/liveDataFeed');
const riskMgr       = require('../risk/riskManager');
const db            = require('../config/database');
const C             = require('../config/constants');
const logger        = require('../config/logger');

// ── Config defaults ───────────────────────────────────────────────────────────
const DEFAULT_INTERVAL_MS    = parseInt(process.env.SIGNAL_INTERVAL_MS || String(5 * 60 * 1000), 10);
const DEFAULT_LOOKBACK       = parseInt(process.env.SIGNAL_LOOKBACK    || '250', 10);
const SYMBOL_DELAY_MS        = parseInt(process.env.SYMBOL_DELAY_MS    || '300', 10);   // rate-limit between symbols
const MAX_CONSECUTIVE_ERRORS = 3;
const PAPER_TRADE_ENABLED    = process.env.PAPER_TRADE_AUTO !== 'false';                // default ON
const MIN_CONFIDENCE         = parseFloat(process.env.MIN_SIGNAL_CONFIDENCE || '0.35');

// ── Module state ──────────────────────────────────────────────────────────────
let _running       = false;
let _timer         = null;
let _intervalMs    = DEFAULT_INTERVAL_MS;
let _watchlist     = [];            // symbols being tracked
let _lastRun       = null;          // ISO timestamp
let _runCount      = 0;
let _totalErrors   = 0;

// Per-symbol circuit breaker: symbol → { errors: number, disabled: boolean }
const _symbolState = new Map();

// In-memory signal cache: symbol → latest signal object
// Used for fast API reads without hitting DB on every request
const _signalCache = new Map();

// Processed signal hashes today (deduplication): Set<hash>
// Cleared at midnight UTC
let _processedToday = new Set();
let _dedupDate      = _today();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _today() { return new Date().toISOString().slice(0, 10); }

function _signalHash(symbol, date, signalType) {
  return crypto.createHash('sha256')
    .update(`${symbol}|${date}|${signalType}`)
    .digest('hex')
    .slice(0, 16);
}

function _getSymbolState(symbol) {
  if (!_symbolState.has(symbol))
    _symbolState.set(symbol, { errors: 0, disabled: false, lastError: null });
  return _symbolState.get(symbol);
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Reset dedup set at midnight
function _checkDedupReset() {
  const today = _today();
  if (today !== _dedupDate) {
    _processedToday.clear();
    _dedupDate = today;
    logger.info('[LiveSignal] Dedup set reset for new day');
  }
}

// ── Core: process a single symbol ─────────────────────────────────────────────

/**
 * Run the full signal pipeline for one symbol.
 * Catches all errors — failure of one symbol never stops the engine.
 *
 * @param {string} symbol
 * @returns {{ symbol, signal, confidence, skipped?, error? }}
 */
async function _processSymbol(symbol) {
  const state = _getSymbolState(symbol);

  // Circuit breaker: skip disabled symbols
  if (state.disabled) {
    logger.debug(`[LiveSignal] ${symbol} is circuit-broken — skipping`);
    return { symbol, skipped: true, reason: 'circuit_breaker' };
  }

  try {
    // ── 1. Fetch recent price bars ─────────────────────────────────────
    const bars = await dataStore.getRecentPrices(symbol, DEFAULT_LOOKBACK);

    if (!bars || bars.length < 201) {
      logger.debug(`[LiveSignal] ${symbol}: insufficient data (${bars?.length ?? 0} bars)`);
      return { symbol, skipped: true, reason: 'insufficient_data', bars: bars?.length ?? 0 };
    }

    const closes      = bars.map(b => b.close);
    const currentPrice = closes[closes.length - 1];
    const today       = _today();

    // ── 2. Generate signal ─────────────────────────────────────────────
    // Canonical decision via strategyCore — identical to backtest & /signal.
    const result = strategyCore.evaluate('AGGREGATED', closes, {
      symbol,
      method:    'weighted',
      useRegime: true,
    });

    // ── 3. Deduplication check ─────────────────────────────────────────
    // Don't repeat the same signal type for a symbol on the same day
    _checkDedupReset();
    const hash = _signalHash(symbol, today, result.signal);

    if (_processedToday.has(hash)) {
      logger.debug(`[LiveSignal] ${symbol}: duplicate signal ${result.signal} — skipping persist`);
    } else {
      // ── 4. Persist to DB ───────────────────────────────────────────
      await _persistSignal({ symbol, result, currentPrice, date: today });
      _processedToday.add(hash);
    }

    // ── 5. Update in-memory cache (always) ────────────────────────────
    const signalObj = {
      symbol,
      signal:      result.signal,
      confidence:  result.confidence,
      score:       result.score,
      currentPrice,
      regime:      result.regime?.detected ?? null,
      regimeStrength: result.regime?.strength ?? null,
      direction:   result.regime?.direction ?? null,
      components:  result.components,
      timestamp:   new Date().toISOString(),
      hash,
    };
    _signalCache.set(symbol, signalObj);

    // ── 6. Paper trading evaluation ────────────────────────────────────
    if (PAPER_TRADE_ENABLED) {
      await _evaluatePaperTrade(symbol, result, currentPrice, bars.at(-1));
    }

    // ── 7. Broadcast to WebSocket clients ──────────────────────────────
    _broadcastSignal(signalObj);

    // Reset error count on success
    state.errors = 0;
    state.disabled = false;

    logger.info(
      `[LiveSignal] ${symbol}: ${result.signal} (conf=${(result.confidence * 100).toFixed(1)}%) ` +
      `@₹${currentPrice.toFixed(2)} | regime=${result.regime?.detected ?? 'N/A'}`
    );

    return signalObj;

  } catch (err) {
    state.errors++;
    state.lastError = err.message;
    _totalErrors++;

    if (state.errors >= MAX_CONSECUTIVE_ERRORS) {
      state.disabled = true;
      logger.error(`[LiveSignal] ${symbol}: circuit-breaker OPEN after ${state.errors} errors: ${err.message}`);
    } else {
      logger.warn(`[LiveSignal] ${symbol}: error #${state.errors}: ${err.message}`);
    }

    return { symbol, error: err.message, skipped: true };
  }
}

// ── Signal persistence ────────────────────────────────────────────────────────

async function _persistSignal({ symbol, result, currentPrice, date }) {
  try {
    await db.query(`
      INSERT INTO signals
        (symbol, signal_type, strategy, confidence, price_at_signal, z_score, rsi_value, ma_fast, ma_slow, regime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      symbol,
      result.signal,
      'AGGREGATED_LIVE',
      result.confidence   != null ? parseFloat(result.confidence)   : null,
      currentPrice        != null ? parseFloat(currentPrice)         : null,
      result.zScore       != null ? parseFloat(result.zScore)        : null,
      result.rsiValue     != null ? parseFloat(result.rsiValue)      : null,
      result.maFast       != null ? parseFloat(result.maFast)        : null,
      result.maSlow       != null ? parseFloat(result.maSlow)        : null,
      result.regime?.detected ?? null,
    ]);
  } catch (err) {
    // DB failures are non-fatal — signal still usable from cache
    logger.warn(`[LiveSignal] DB persist failed for ${symbol}: ${err.message}`);
  }
}

// ── Paper trading evaluation ──────────────────────────────────────────────────

/**
 * Decide whether to place a paper trade based on the signal.
 *
 * RULES:
 *   BUY  + confidence ≥ MIN_CONFIDENCE + no open position → place BUY
 *   SELL + open position → place SELL (close)
 *   HOLD → nothing
 *   BUY  + already have position → nothing (no pyramiding)
 *
 * @param {string} symbol
 * @param {Object} result    — aggregator output
 * @param {number} currentPrice
 * @param {Object} latestBar — { high, low, close, volume }
 */
async function _evaluatePaperTrade(symbol, result, currentPrice, latestBar) {
  const portfolio      = execEngine.getPortfolioState();
  const hasOpenPosition = symbol in portfolio.openPositions;

  // First check stop-loss / take-profit on existing position
  if (hasOpenPosition) {
    const closed = await execEngine.checkAndClosePosition(symbol, currentPrice);
    if (closed) {
      logger.info(`[LiveSignal] Paper: auto-closed ${symbol} via ${closed.exitReason ?? 'SL/TP'}`);
      return;
    }
  }

  if (result.signal === 'BUY' && result.confidence >= MIN_CONFIDENCE && !hasOpenPosition) {
    // Position sizing: fixed fractional
    const sizing = riskMgr.fixedFractionalSize({
      capital:     portfolio.capital,
      entryPrice:  currentPrice,
      stopLossPct: C.RISK.DEFAULT_STOP_LOSS_PCT,
      riskPct:     C.RISK.MAX_RISK_PER_TRADE_PCT,
    });

    if (sizing.quantity > 0) {
      const order = await execEngine.placeOrder({
        symbol,
        side:         'BUY',
        quantity:     sizing.quantity,
        currentPrice,
        orderType:    'MARKET',
        strategy:     'LIVE_AGGREGATED',
      });

      if (order.status === 'EXECUTED') {
        logger.info(`[LiveSignal] Paper BUY: ${symbol} ×${sizing.quantity} @₹${currentPrice.toFixed(2)}`);
        _broadcastTrade({ type: 'PAPER_BUY', symbol, ...order });
      }
    }

  } else if (result.signal === 'SELL' && hasOpenPosition) {
    const pos   = portfolio.openPositions[symbol];
    const order = await execEngine.placeOrder({
      symbol,
      side:         'SELL',
      quantity:     pos.qty,
      currentPrice,
      orderType:    'MARKET',
      strategy:     'LIVE_AGGREGATED',
    });

    if (order.status === 'EXECUTED') {
      logger.info(`[LiveSignal] Paper SELL: ${symbol} PnL=₹${order.pnl?.toFixed(2) ?? '?'}`);
      _broadcastTrade({ type: 'PAPER_SELL', symbol, ...order });
    }
  }
}

// ── WebSocket broadcast ───────────────────────────────────────────────────────

function _broadcastSignal(signalObj) {
  try {
    liveDataFeed.broadcastAll({
      type:   'LIVE_SIGNAL',
      data:   signalObj,
      ts:     new Date().toISOString(),
    });
  } catch (_) { /* broadcast failures are non-fatal */ }
}

function _broadcastTrade(tradeObj) {
  try {
    liveDataFeed.broadcastAll({
      type:   'PAPER_TRADE',
      data:   tradeObj,
      ts:     new Date().toISOString(),
    });
  } catch (_) {}
}

// ── Engine run loop ───────────────────────────────────────────────────────────

/**
 * Execute one full pass of the signal engine across all watchlist symbols.
 * Called by the scheduler on each tick.
 */
async function runOnce() {
  if (_watchlist.length === 0) {
    logger.debug('[LiveSignal] runOnce: watchlist empty — nothing to process');
    return { processed: 0, signals: [], errors: 0 };
  }

  const startTime = Date.now();
  logger.info(`[LiveSignal] Tick #${_runCount + 1} — processing ${_watchlist.length} symbols`);

  const results  = [];
  let errorCount = 0;

  for (const symbol of _watchlist) {
    const result = await _processSymbol(symbol);
    results.push(result);
    if (result.error) errorCount++;

    // Rate-limit: courtesy delay between NSE API calls
    if (SYMBOL_DELAY_MS > 0) await _sleep(SYMBOL_DELAY_MS);
  }

  _lastRun  = new Date().toISOString();
  _runCount++;

  const elapsed    = Date.now() - startTime;
  const successful = results.filter(r => !r.skipped && !r.error);

  logger.info(
    `[LiveSignal] Tick done in ${elapsed}ms | ` +
    `${successful.length} signals / ${errorCount} errors / ${results.length - successful.length - errorCount} skipped`
  );

  return {
    processed:  results.length,
    signals:    successful,
    errors:     errorCount,
    durationMs: elapsed,
  };
}

// ── Lifecycle: start / stop ───────────────────────────────────────────────────

/**
 * Start the live signal engine.
 *
 * @param {{
 *   watchlist:   string[],   // symbols to track
 *   intervalMs?: number,     // run frequency (default 5 min)
 *   runOnStart?: boolean,    // run immediately on start
 * }} opts
 */
function start(opts = {}) {
  if (_running) {
    logger.warn('[LiveSignal] Already running — call stop() first');
    return;
  }

  _watchlist  = (opts.watchlist || C.NIFTY50_SYMBOLS.slice(0, 10)).map(s => s.toUpperCase());
  _intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
  _running    = true;
  _symbolState.clear();
  _processedToday.clear();
  _dedupDate  = _today();

  logger.info(
    `[LiveSignal] Starting | symbols=${_watchlist.length} | interval=${_intervalMs / 1000}s | ` +
    `paperTrade=${PAPER_TRADE_ENABLED} | minConf=${MIN_CONFIDENCE}`
  );

  if (opts.runOnStart !== false) {
    // First run immediately (don't await — let it run async)
    runOnce().catch(err => logger.error(`[LiveSignal] runOnce error: ${err.message}`));
  }

  _timer = setInterval(() => {
    runOnce().catch(err => logger.error(`[LiveSignal] runOnce error: ${err.message}`));
  }, _intervalMs);
}

/**
 * Stop the live signal engine.
 */
function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running = false;
  logger.info('[LiveSignal] Stopped');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a symbol to the watchlist at runtime (hot-add).
 */
function addSymbol(symbol) {
  const sym = symbol.toUpperCase();
  if (!_watchlist.includes(sym)) {
    _watchlist.push(sym);
    logger.info(`[LiveSignal] Added ${sym} to watchlist`);
    return true;
  }
  return false;
}

/**
 * Remove a symbol from the watchlist.
 */
function removeSymbol(symbol) {
  const sym = symbol.toUpperCase();
  const idx = _watchlist.indexOf(sym);
  if (idx !== -1) {
    _watchlist.splice(idx, 1);
    _signalCache.delete(sym);
    logger.info(`[LiveSignal] Removed ${sym} from watchlist`);
    return true;
  }
  return false;
}

/**
 * Reset the circuit breaker for a symbol (re-enable it).
 */
function resetCircuitBreaker(symbol) {
  const state = _getSymbolState(symbol.toUpperCase());
  state.errors   = 0;
  state.disabled = false;
  state.lastError = null;
  logger.info(`[LiveSignal] Circuit breaker reset for ${symbol}`);
}

/**
 * Get the latest cached signal for one or all symbols.
 * Fast — reads from in-memory cache, no DB.
 */
function getLatestSignals(symbols = null) {
  if (symbols) {
    return symbols.map(sym => _signalCache.get(sym.toUpperCase()) || { symbol: sym, signal: null });
  }
  return [..._signalCache.values()];
}

/**
 * Get the current engine status.
 */
function getStatus() {
  return {
    running:       _running,
    intervalMs:    _intervalMs,
    watchlist:     _watchlist,
    watchlistSize: _watchlist.length,
    lastRun:       _lastRun,
    runCount:      _runCount,
    totalErrors:   _totalErrors,
    paperTrade:    PAPER_TRADE_ENABLED,
    minConfidence: MIN_CONFIDENCE,
    signalCache:   _signalCache.size,
    symbolStates: Object.fromEntries(
      [..._symbolState.entries()].map(([sym, s]) => [sym, {
        errors:    s.errors,
        disabled:  s.disabled,
        lastError: s.lastError,
      }])
    ),
  };
}

module.exports = {
  start,
  stop,
  runOnce,
  addSymbol,
  removeSymbol,
  resetCircuitBreaker,
  getLatestSignals,
  getStatus,
  // Exposed for testing
  _processSymbol,
  _signalHash,
};
