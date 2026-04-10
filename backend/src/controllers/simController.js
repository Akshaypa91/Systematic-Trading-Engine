// src/controllers/simController.js
// ─────────────────────────────────────────────────────────────────────────────
// REST API controller backed entirely by simulationEngine.
// Zero external dependencies — works with no DB, no NSE connection.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const sim = require('../engine/simulationEngine');

// ── GET /api/sim/signals ──────────────────────────────────────────────────────
function getLiveSignals(req, res) {
  const symbols = req.query.symbols
    ? req.query.symbols.split(',').map(s => s.trim().toUpperCase())
    : null;

  const signals = sim.getLatestSignals(symbols);
  const status  = sim.getStatus();

  res.json({
    success: true,
    count:   signals.length,
    mode:    'SIMULATION',
    status,
    signals,
  });
}

// ── GET /api/sim/portfolio ────────────────────────────────────────────────────
function getPortfolio(req, res) {
  res.json({
    success: true,
    data:    sim.getPortfolioState(),
  });
}

// ── GET /api/sim/trades ───────────────────────────────────────────────────────
function getTrades(req, res) {
  const limit = Math.min(parseInt(req.query.limit || '30', 10), 200);
  const trades = sim.getRecentTrades(limit);
  res.json({
    success: true,
    count:   trades.length,
    data:    trades,
  });
}

// ── GET /api/sim/equity ───────────────────────────────────────────────────────
function getEquityCurve(req, res) {
  const curve = sim.getEquityCurve();
  res.json({
    success: true,
    count:   curve.length,
    data:    curve,
  });
}

// ── GET /api/sim/status ───────────────────────────────────────────────────────
function getStatus(req, res) {
  res.json({
    success:   true,
    engine:    sim.getStatus(),
    portfolio: sim.getPortfolioState(),
    timestamp: new Date().toISOString(),
  });
}

// ── POST /api/sim/engine/start ────────────────────────────────────────────────
function startEngine(req, res) {
  const { watchlist, intervalMs } = req.body || {};
  sim.start({ watchlist, intervalMs });
  res.json({ success: true, message: 'Simulation engine started', status: sim.getStatus() });
}

// ── POST /api/sim/engine/stop ─────────────────────────────────────────────────
function stopEngine(req, res) {
  sim.stop();
  res.json({ success: true, message: 'Simulation engine stopped' });
}

// ── POST /api/sim/watchlist/add ───────────────────────────────────────────────
function addToWatchlist(req, res) {
  const { symbol } = req.body || {};
  if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
  const added = sim.addSymbol(symbol);
  res.json({ success: true, added, status: sim.getStatus() });
}

// ── POST /api/sim/watchlist/remove ────────────────────────────────────────────
function removeFromWatchlist(req, res) {
  const { symbol } = req.body || {};
  if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });
  const removed = sim.removeSymbol(symbol);
  res.json({ success: true, removed });
}

module.exports = {
  getLiveSignals, getPortfolio, getTrades, getEquityCurve,
  getStatus, startEngine, stopEngine,
  addToWatchlist, removeFromWatchlist,
};
