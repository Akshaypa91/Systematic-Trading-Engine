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

// ── POST /api/sim/auto-trade ───────────────────────────────────────────────────
// Run ONE automatic paper-trading pass immediately (entries + exits) on the
// DB-backed portfolio the UI shows. Lets you verify auto-trading without waiting
// for the scheduler. Paper only — never touches the broker.
async function runAutoTrade(req, res) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  try {
    const autoPaper = require('../engine/autoPaperTrader');
    const C = require('../config/constants');
    const symbols = Array.isArray(req.body?.symbols) && req.body.symbols.length
      ? req.body.symbols
      : (C.NIFTY50_SYMBOLS || []).slice(0, 20);
    // ?force=1 lets you test outside market hours; it will still refuse to act
    // on SIM prices, so after-hours runs mostly report skips.
    const force = req.query?.force === '1' || req.body?.force === true;
    const result = await autoPaper.runOnce(userId, symbols, { force });
    return res.json({ success: true, ...result, config: autoPaper.getConfig() });
  } catch (err) {
    logger.error(`[SimCtrl] runAutoTrade: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

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
  const userId = req.user?.userId ?? req.user?.id ?? null;
  try {
    let state = await portfolio.getState(userId);

    // Re-base the PAPER trade rows for any split/bonus, else a post-bonus price
    // against a pre-bonus entry shows a phantom ~50% loss. Must operate on the
    // DB (positions are derived from sim_trades) — adjusting simulationEngine's
    // in-memory book did nothing, because the UI reads this one. Idempotent.
    try {
      const adj = require('../portfolio/corpActionAdjuster');
      const r = await adj.adjustPortfolio(state.portfolioId);
      if (r.adjusted > 0) {
        portfolio._clearCache?.(userId);
        state = await portfolio.getState(userId);   // re-read post-adjustment
        logger.info(`[SimCtrl] corp-action adjusted: ${r.symbols.join(', ')}`);
      }
    } catch (e) { logger.debug(`[SimCtrl] corp-adjust: ${e.message}`); }

    // If not initialized yet return empty safe structure — don't 500
    if (!state.initialized) {
      return res.json({
        success: true,
        data: {
          capital:        0,
          initialCapital: 0,
          positions:      {},
          trades:         [],
          initialized:    false,
          unrealizedPnL:  0,
          realizedPnL:    0,
          totalPnL:       0,
          totalPnLPct:    0,
          totalValue:     0,
          positionsValue: 0,
          biggestGainer:  null,
          biggestLoser:   null,
          pricesAt:       new Date().toISOString(),
        },
      });
    }

    const symbols = Object.keys(state.positions);

    // Fetch live prices (batch) — fall back to entry prices on error
    let priceMap = {};
    if (symbols.length > 0) {
      try {
        const priceResults = await marketDataSvc.getBatchPrices(symbols);
        for (const { symbol, price } of priceResults) {
          priceMap[symbol] = parseFloat(price) || 0;
        }
      } catch (priceErr) {
        logger.warn(`[SimCtrl] price fetch failed: ${priceErr.message} — using entry prices`);
      }
      // Guard: any symbol without a valid (>0) live price — unresolved symbol,
      // market closed, or a 0 tick — must fall back to its entry price so P&L
      // reads flat (0%) instead of a bogus -100% loss against a zero price.
      for (const [sym, pos] of Object.entries(state.positions)) {
        if (!(priceMap[sym] > 0)) priceMap[sym] = parseFloat(pos.entryPrice) || 0;
      }
    }

    // Enrich positions — pnlCalc expects numeric values; positions already coerced in repo
    const enrichedPositions = pnlCalc.enrichPositionsWithPnL(state.positions, priceMap);

    // Fetch trade history from DB for realized PnL calculation
    let trades = [];
    try {
      if (state.portfolioId) {
        const repo = require('../portfolio/portfolioRepository');
        trades = await repo.getTrades(state.portfolioId, 50);
      }
    } catch (tradeErr) {
      logger.warn(`[SimCtrl] trade fetch failed: ${tradeErr.message}`);
    }

    // Normalize trade pnl fields to numbers
    const normalizedTrades = trades.map(t => ({
      ...t,
      price: parseFloat(t.price) || 0,
      value: parseFloat(t.value) || 0,
      pnl:   t.pnl !== null && t.pnl !== undefined ? parseFloat(t.pnl) : null,
    }));

    const summary = pnlCalc.calcPortfolioSummary(
      enrichedPositions,
      parseFloat(state.capital)        || 0,
      parseFloat(state.initialCapital) || 0,
      normalizedTrades
    );

    res.json({
      success: true,
      data: {
        capital:        parseFloat(state.capital)        || 0,
        initialCapital: parseFloat(state.initialCapital) || 0,
        portfolioId:    state.portfolioId,
        initialized:    state.initialized,
        positions:      enrichedPositions,
        trades:         normalizedTrades,
        unrealizedPnL:  parseFloat(summary.unrealizedPnL)  || 0,
        realizedPnL:    parseFloat(summary.realizedPnL)    || 0,
        totalPnL:       parseFloat(summary.totalPnL)       || 0,
        totalPnLPct:    parseFloat(summary.totalPnLPct)    || 0,
        totalValue:     parseFloat(summary.totalValue)     || 0,
        positionsValue: parseFloat(summary.positionsValue) || 0,
        biggestGainer:  summary.biggestGainer,
        biggestLoser:   summary.biggestLoser,
        pricesAt:       new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(`[SimCtrl] getPortfolio: ${err.message}\n${err.stack}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/sim/trades ───────────────────────────────────────────────────────
function getTrades(req, res) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  const limit  = Math.min(parseInt(req.query.limit || '30', 10), 200);
  const trades = sim.getRecentTrades(limit, userId);
  res.json({ success: true, count: trades.length, data: trades });
}

// ── GET /api/sim/equity ───────────────────────────────────────────────────────
function getEquityCurve(req, res) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  const curve = sim.getEquityCurve(userId);
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
  const userId = req.user?.userId ?? req.user?.id ?? null;
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

    await portfolio.initialize(cap, userId);
    sim.initUserPortfolio(userId, cap);

    logger.info(`[SimCtrl] Portfolio initialized: ₹${cap.toLocaleString('en-IN')}`);

    const state = await portfolio.getState(userId);
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
  const userId = req.user?.userId ?? req.user?.id ?? null;
  try {
    const state = await portfolio.getState(userId);

    if (!state.initialized) {
      return res.status(400).json({
        success: false,
        error:   'Portfolio not initialized. Call POST /api/sim/start first.',
      });
    }

    await portfolio.resetToInitial(userId);
    sim.resetUserPortfolio(userId);

    logger.info(`[SimCtrl] Portfolio reset to ₹${state.initialCapital.toLocaleString('en-IN')}`);

    const newState = await portfolio.getState(userId);
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


// ── POST /api/sim/exit-one ────────────────────────────────────────────────────
/**
 * Close ONE position by symbol at current market price.
 * Body: { symbol }
 */
async function exitOne(req, res) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  const sym    = (req.body.symbol || '').toUpperCase().trim();

  if (!sym) return res.status(400).json({ success: false, error: 'symbol required' });

  try {
    const state = await portfolio.getState(userId);
    const pos   = state.positions?.[sym];
    if (!pos) return res.status(404).json({ success: false, error: `No open position for ${sym}` });

    // Get live price
    let price = pos.entryPrice;
    try {
      const p = await marketDataSvc.getBestPrice(sym);
      if (p?.price > 0) price = p.price;
    } catch (_) {}

    const result     = await portfolio.executeSell(sym, pos.qty, price, 'API', userId);
    const finalState = await portfolio.getState(userId);

    logger.info(`[SimCtrl] exitOne: closed ${sym} ${pos.qty} @ ₹${price} | PnL ₹${result.pnl}`);

    return res.json({
      success:    true,
      symbol:     sym,
      qty:        pos.qty,
      price:      parseFloat(price.toFixed(2)),
      realizedPnL:parseFloat((result.pnl ?? 0).toFixed(2)),
      trade:      result.trade,
      portfolio:  finalState,
    });
  } catch (err) {
    logger.error(`[SimCtrl] exitOne: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/sim/exit-all ────────────────────────────────────────────────────
/**
 * Close ALL open positions at current market price.
 * Fetches live price per symbol, sells full qty, updates capital.
 * Response: { success, closedCount, totalProceeds, realizedPnL, trades, portfolio }
 */
async function exitAll(req, res) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  try {
    const state   = await portfolio.getState(userId);
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
        const result = await portfolio.executeSell(sym, pos.qty, price, 'API', userId);
        closedTrades.push(result.trade);
        totalProceeds += pos.qty * price;
        totalRealPnL  += result.pnl ?? 0;
        logger.info(`[SimCtrl] exitAll: closed ${sym} ${pos.qty} @ ₹${price} | PnL ₹${result.pnl}`);
      } catch (sellErr) {
        logger.error(`[SimCtrl] exitAll: failed to close ${sym}: ${sellErr.message}`);
      }
    }

    logger.info(`[SimCtrl] exitAll complete: ${closedTrades.length} positions closed, PnL ₹${totalRealPnL.toFixed(2)}`);

    const finalState = await portfolio.getState(userId);
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
  runAutoTrade,
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
  exitOne,
};
