// src/controllers/simController.js
// ─────────────────────────────────────────────────────────────────────────────
// REST API controller backed by simulationEngine + portfolioState.
// Adds POST /api/sim/start and POST /api/sim/reset for user-defined capital.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const sim           = require('../engine/simulationEngine');
const portfolio     = require('../portfolio/portfolioState');
const logger        = require('../config/logger');
const marketDataSvc = require('../services/marketDataService');
const pnlCalc       = require('../utils/pnlCalculator');

// ── GET /api/sim/signals ──────────────────────────────────────────────────────
function getLiveSignals(req, res) {
  const symbols = req.query.symbols
    ? req.query.symbols.split(',').map(s => s.trim().toUpperCase())
    : null;

  const raw    = sim.getLatestSignals(symbols);
  const status = sim.getStatus();

  // Normalise each signal: ensure source field + all indicator fields present
  const signals = raw.map(s => ({
    ...s,
    source:   s.source  || 'SIM',          // 'LIVE' | 'SIM'
    rsi:      s.rsi     ?? null,
    sma20:    s.sma20   ?? null,
    sma50:    s.sma50   ?? null,
    bbUpper:  s.bbUpper ?? null,
    bbLower:  s.bbLower ?? null,
    bbMiddle: s.bbMiddle ?? null,
    score:    s.score   ?? null,
    components: s.components ?? {},
  }));

  res.json({ success: true, count: signals.length, mode: 'SIMULATION', status, signals });
}

// ── GET /api/sim/portfolio ────────────────────────────────────────────────────
async function getPortfolio(req, res) {
  try {
    const state   = await portfolio.getState();
    const symbols = Object.keys(state.positions);

    // Fetch live prices for open positions (batch + sim fallback)
    let priceMap = {};
    if (symbols.length > 0) {
      try {
        const priceResults = await marketDataSvc.getBatchPrices(symbols);
        for (const { symbol, price } of priceResults) priceMap[symbol] = price;
      } catch (priceErr) {
        logger.warn(`[SimCtrl] price fetch failed: ${priceErr.message} — using entry prices`);
        for (const [sym, pos] of Object.entries(state.positions)) priceMap[sym] = pos.entryPrice;
      }
    }

    const enrichedPositions = pnlCalc.enrichPositionsWithPnL(state.positions, priceMap);
    const summary = pnlCalc.calcPortfolioSummary(
      enrichedPositions, state.capital, state.initialCapital, state.trades
    );

    res.json({
      success: true,
      data: {
        ...state,
        positions:      enrichedPositions,
        unrealizedPnL:  summary.unrealizedPnL,
        realizedPnL:    summary.realizedPnL,
        totalPnL:       summary.totalPnL,
        totalPnLPct:    summary.totalPnLPct,
        totalValue:     summary.totalValue,
        positionsValue: summary.positionsValue,
        biggestGainer:  summary.biggestGainer,
        biggestLoser:   summary.biggestLoser,
        pricesAt:       new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(`[SimCtrl] getPortfolio: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/sim/trades ───────────────────────────────────────────────────────
function getTrades(req, res) {
  const limit  = Math.min(parseInt(req.query.limit || '30', 10), 200);
  const trades = sim.getRecentTrades(limit);
  res.json({ success: true, count: trades.length, data: trades });
}

// ── GET /api/sim/equity ───────────────────────────────────────────────────────
function getEquityCurve(req, res) {
  const curve = sim.getEquityCurve();
  res.json({ success: true, count: curve.length, data: curve });
}

// ── GET /api/sim/status ───────────────────────────────────────────────────────
function getStatus(req, res) {
  res.json({
    success:   true,
    engine:    sim.getStatus(),
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

// ── POST /api/sim/start ───────────────────────────────────────────────────────
/**
 * Initialize portfolio with user-defined capital.
 * Clears all positions and trade history.
 * Body: { capital: number }
 *
 * Response: { success, message, portfolio }
 */
async function startWithCapital(req, res) {
  try {
    const { capital } = req.body || {};

    if (capital === undefined || capital === null || capital === '') {
      return res.status(400).json({ success: false, error: 'capital is required' });
    }

    const cap = Number(capital);
    if (!Number.isFinite(cap) || cap <= 0) {
      return res.status(400).json({
        success: false,
        error:   `capital must be a positive number, got "${capital}"`,
      });
    }
    if (cap < 1000) {
      return res.status(400).json({
        success: false,
        error:   'Minimum capital is ₹1,000',
      });
    }
    if (cap > 1e9) {
      return res.status(400).json({
        success: false,
        error:   'Maximum capital is ₹1,00,00,00,000 (1 billion)',
      });
    }

    await portfolio.initialize(cap);

    logger.info(`[SimCtrl] Portfolio initialized: ₹${cap.toLocaleString('en-IN')}`);

    const state = await portfolio.getState();
    res.status(200).json({
      success:   true,
      message:   `Portfolio initialized with ₹${cap.toLocaleString('en-IN')} capital`,
      portfolio: state,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error(`[SimCtrl] startWithCapital: ${err.message}`);
    res.status(code).json({ success: false, error: err.message });
  }
}

// ── POST /api/sim/reset ───────────────────────────────────────────────────────
/**
 * Reset portfolio to initial capital (from last /api/sim/start call).
 * Clears positions and trades, restores starting capital.
 *
 * Response: { success, message, portfolio }
 */
async function resetPortfolio(req, res) {
  try {
    const state = await portfolio.getState();

    if (!state.initialized) {
      return res.status(400).json({
        success: false,
        error:   'Portfolio not initialized. Call POST /api/sim/start first.',
      });
    }

    await portfolio.resetToInitial();

    logger.info(`[SimCtrl] Portfolio reset to ₹${state.initialCapital.toLocaleString('en-IN')}`);

    const newState = await portfolio.getState();
    res.status(200).json({
      success:   true,
      message:   `Portfolio reset to ₹${state.initialCapital.toLocaleString('en-IN')}`,
      portfolio: newState,
    });
  } catch (err) {
    logger.error(`[SimCtrl] resetPortfolio: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}


// ── POST /api/sim/exit-all ────────────────────────────────────────────────────
/**
 * Close ALL open positions at current market price.
 * Fetches live price per symbol, sells full qty, updates capital.
 * Response: { success, closedCount, totalProceeds, realizedPnL, trades, portfolio }
 */
async function exitAll(req, res) {
  try {
    const state   = await portfolio.getState();
    const symbols = Object.keys(state.positions);

    if (!state.initialized) {
      return res.status(400).json({ success: false, error: 'Portfolio not initialized' });
    }
    if (symbols.length === 0) {
      return res.status(400).json({ success: false, error: 'No open positions to close' });
    }

    // Fetch all current prices in one batch
    let priceMap = {};
    try {
      const priceResults = await marketDataSvc.getBatchPrices(symbols);
      for (const { symbol, price } of priceResults) priceMap[symbol] = price;
    } catch (priceErr) {
      logger.warn(`[SimCtrl] exitAll price fetch failed: ${priceErr.message} — using entry prices`);
      for (const [sym, pos] of Object.entries(state.positions)) priceMap[sym] = pos.entryPrice;
    }

    // Close each position
    const closedTrades = [];
    let totalProceeds  = 0;
    let totalRealPnL   = 0;

    for (const sym of symbols) {
      const pos   = state.positions[sym];
      if (!pos) continue;
      const price = priceMap[sym] ?? pos.entryPrice;

      try {
        const result = await portfolio.executeSell(sym, pos.qty, price, 'API');
        closedTrades.push(result.trade);
        totalProceeds += pos.qty * price;
        totalRealPnL  += result.pnl ?? 0;
        logger.info(`[SimCtrl] exitAll: closed ${sym} ${pos.qty} @ ₹${price} | PnL ₹${result.pnl}`);
      } catch (sellErr) {
        logger.error(`[SimCtrl] exitAll: failed to close ${sym}: ${sellErr.message}`);
      }
    }

    logger.info(`[SimCtrl] exitAll complete: ${closedTrades.length} positions closed, PnL ₹${totalRealPnL.toFixed(2)}`);

    const finalState = await portfolio.getState();
    res.json({
      success:       true,
      closedCount:   closedTrades.length,
      totalProceeds: parseFloat(totalProceeds.toFixed(2)),
      realizedPnL:   parseFloat(totalRealPnL.toFixed(2)),
      trades:        closedTrades,
      portfolio:     finalState,
    });
  } catch (err) {
    logger.error(`[SimCtrl] exitAll: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getLiveSignals,
  getPortfolio,
  getTrades,
  getEquityCurve,
  getStatus,
  startEngine,
  stopEngine,
  addToWatchlist,
  removeFromWatchlist,
  startWithCapital,
  resetPortfolio,
  exitAll,
};
