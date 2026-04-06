// src/controllers/liveController.js
// REST API for the live signal engine and paper trading
'use strict';

const liveSignalEngine = require('../engine/liveSignalEngine');
const execEngine       = require('../engine/executionEngine');
const scheduler        = require('../engine/scheduler');
const db               = require('../config/database');
const logger           = require('../config/logger');

// ── GET /api/live/signals ─────────────────────────────────────────────────────
// Returns latest cached signal for every symbol in the watchlist.
// Reads from in-memory cache — zero DB latency.
function getLiveSignals(req, res) {
  try {
    const symbols = req.query.symbols
      ? req.query.symbols.split(',').map(s => s.trim().toUpperCase())
      : null;

    const signals = liveSignalEngine.getLatestSignals(symbols);
    const status  = liveSignalEngine.getStatus();

    res.json({
      success:    true,
      count:      signals.length,
      lastRun:    status.lastRun,
      nextRunIn:  status.intervalMs,
      signals,
    });
  } catch (err) {
    logger.error(`[LiveCtrl] getLiveSignals: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/signals/history ─────────────────────────────────────────────
// DB query — returns persisted AGGREGATED_LIVE signals with pagination.
async function getSignalHistory(req, res) {
  try {
    const symbol = req.query.symbol?.toUpperCase() || null;
    const limit  = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);

    const whereClause = symbol ? "WHERE symbol = ? AND strategy = 'AGGREGATED_LIVE'" : "WHERE strategy = 'AGGREGATED_LIVE'";
    const params      = symbol ? [symbol, limit, offset] : [limit, offset];

    const [rows] = await db.query(
      `SELECT * FROM signals ${whereClause} ORDER BY signal_ts DESC LIMIT ? OFFSET ?`,
      params
    );

    res.json({ success: true, count: rows.length, limit, offset, data: rows });
  } catch (err) {
    logger.error(`[LiveCtrl] getSignalHistory: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/trades ──────────────────────────────────────────────────────
// Returns recent paper trades from DB.
async function getLatestTrades(req, res) {
  try {
    const limit  = Math.min(parseInt(req.query.limit || '20', 10), 200);
    const symbol = req.query.symbol?.toUpperCase() || null;

    const whereClause = symbol ? 'WHERE symbol = ?' : '';
    const params = symbol ? [symbol, limit] : [limit];

    const [rows] = await db.query(
      `SELECT * FROM paper_trades ${whereClause} ORDER BY created_at DESC LIMIT ?`,
      params
    );

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    logger.error(`[LiveCtrl] getLatestTrades: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/portfolio ───────────────────────────────────────────────────
// Current paper portfolio state (in-memory, instant).
function getPaperPortfolio(req, res) {
  try {
    const state = execEngine.getPortfolioState();
    res.json({ success: true, data: state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/live/status ──────────────────────────────────────────────────────
// Engine status + scheduler job status.
function getEngineStatus(req, res) {
  try {
    res.json({
      success:   true,
      engine:    liveSignalEngine.getStatus(),
      scheduler: scheduler.getJobStatus(),
      marketOpen: scheduler.isMarketHours(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/engine/start ───────────────────────────────────────────────
// Start the engine with a custom watchlist (or defaults).
function startEngine(req, res) {
  try {
    const { watchlist, intervalMs } = req.body || {};
    liveSignalEngine.start({ watchlist, intervalMs, runOnStart: true });
    res.json({ success: true, message: 'Live signal engine started', status: liveSignalEngine.getStatus() });
  } catch (err) {
    logger.error(`[LiveCtrl] startEngine: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/engine/stop ────────────────────────────────────────────────
function stopEngine(req, res) {
  try {
    liveSignalEngine.stop();
    res.json({ success: true, message: 'Live signal engine stopped' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/engine/run ─────────────────────────────────────────────────
// Trigger one immediate run (for testing / manual refresh).
async function triggerRun(req, res) {
  try {
    const result = await liveSignalEngine.runOnce();
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`[LiveCtrl] triggerRun: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/watchlist/add ──────────────────────────────────────────────
function addToWatchlist(req, res) {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
    const added = liveSignalEngine.addSymbol(symbol);
    res.json({ success: true, added, status: liveSignalEngine.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/watchlist/remove ──────────────────────────────────────────
function removeFromWatchlist(req, res) {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
    const removed = liveSignalEngine.removeSymbol(symbol);
    res.json({ success: true, removed, status: liveSignalEngine.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/live/circuit-breaker/reset ──────────────────────────────────────
function resetCircuitBreaker(req, res) {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
    liveSignalEngine.resetCircuitBreaker(symbol);
    res.json({ success: true, message: `Circuit breaker reset for ${symbol}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getLiveSignals,
  getSignalHistory,
  getLatestTrades,
  getPaperPortfolio,
  getEngineStatus,
  startEngine,
  stopEngine,
  triggerRun,
  addToWatchlist,
  removeFromWatchlist,
  resetCircuitBreaker,
};
