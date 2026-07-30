// src/controllers/signalController.js — REGIME-AWARE UPGRADE
'use strict';

const dataStore  = require('../data/dataStore');
const strategyCore = require('../engine/strategyCore');
const { detectRegimeWithRouting, resetSmoothing } = require('../engine/regimeDetector');
const signalEngine = require('../engine/signalEngine');
const marketData   = require('../services/marketDataService');
const corpActions  = require('../data/corporateActions');
const db         = require('../config/database');
const logger     = require('../config/logger');

// Fewest bars we will compute a signal over. The slowest indicator here is the
// 50-period SMA, and a 50-SMA with 51 bars carries no information — 60 gives the
// regime filter and Bollinger bands something to work with too. Below this the
// endpoint returns 503 rather than a number.
const MIN_BARS_FOR_SIGNAL = 60;

// Real-market fallback: when the local DB has too few bars, pull daily candles
// straight from Upstox (only works when a broker session is live) so signals
// are computed on real prices. There is no fallback beyond this one — if Upstox
// has nothing either, the request fails.
// Returns bar objects shaped like dataStore.getRecentPrices ({ close, ... }).
async function _upstoxBars(symbol, minBars) {
  try {
    const cd = await marketData.getCandles(symbol, { interval: 'day', days: 400 });
    const candles = cd?.candles || [];
    if (candles.length < minBars) return null;
    return candles.map(c => ({ ts: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
  } catch (e) {
    logger.debug(`[SignalCtrl] Upstox candle fallback failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// ── GET /api/signal/:symbol ───────────────────────────────────────────────────
async function getSignal(req, res) {
  try {
    const { symbol }  = req.params;
    const strategy    = (req.query.strategy || 'AGGREGATED').toUpperCase();
    const method      = req.query.method    || 'weighted';
    const lookback    = parseInt(req.query.lookback || '250', 10);
    const useRegime   = req.query.regime !== 'false';  // default: regime ON

    let bars = [];
    let dataSource = 'DB';
    // dataStore now applies corporate-action adjustment itself, so bars arrive
    // pre-adjusted. Do NOT adjust again here — a second pass would halve prices
    // twice (₹2,606 → ₹1,303 → ₹651).
    try { bars = await dataStore.getRecentPrices(symbol.toUpperCase(), lookback); } catch (_) {}

    // ── Upstox candle fallback: thin/empty DB → real daily candles (broker) ───
    if (!bars || bars.length < 60) {
      const ub = await _upstoxBars(symbol.toUpperCase(), 60);
      if (ub) {
        logger.info(`[SignalCtrl] Using Upstox candles for ${symbol} (${ub.length} bars, DB had ${bars?.length ?? 0})`);
        bars = ub;
        dataSource = 'UPSTOX';
      }
    }

    // ── No real data → say so ─────────────────────────────────────────────────
    // This branch used to fall back to the simulation engine and return a full
    // signal — RSI, SMAs, Bollinger bands, a confidence score — computed over a
    // random walk, flagged only by a small `simMode: true` field the UI barely
    // surfaced. An interviewer opening the dashboard saw RELIANCE at ₹2,845 with
    // bands of ₹516–₹2,379 and no reason to doubt any of it.
    //
    // A signal endpoint with no data must return an error, not a number.
    if (!bars || bars.length < MIN_BARS_FOR_SIGNAL) {
      logger.warn(`[SignalCtrl] ${symbol}: only ${bars?.length ?? 0} real bars — refusing to compute a signal`);
      return res.status(503).json({
        success:  false,
        error:    'NO_MARKET_DATA',
        symbol:   symbol.toUpperCase(),
        bars:     bars?.length ?? 0,
        required: MIN_BARS_FOR_SIGNAL,
        message:  `No usable price history for ${symbol.toUpperCase()} (${bars?.length ?? 0} of ${MIN_BARS_FOR_SIGNAL} bars). `
                + 'Connect Upstox or run the daily data sync — this engine does not generate placeholder prices.',
      });
    }

    const closes = bars.map(b => b.close);

    // Canonical signal decision — same code path as backtest & live.
    const result = strategyCore.evaluate(strategy, closes, {
      method,
      symbol: symbol.toUpperCase(),
      useRegime,
      bbMode: req.query.bbMode || 'mean_reversion',
    });

    // Persist signal
    try {
      await db.query(
        `INSERT INTO signals (symbol, signal_type, strategy, confidence, price_at_signal, z_score, rsi_value, ma_fast, ma_slow)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [symbol.toUpperCase(), result.signal, strategy,
         result.confidence    != null ? parseFloat(result.confidence)    : null,
         result.currentPrice  != null ? parseFloat(result.currentPrice)  : null,
         result.zScore        != null ? parseFloat(result.zScore)        : null,
         result.rsiValue      != null ? parseFloat(result.rsiValue)      : null,
         result.maFast        != null ? parseFloat(result.maFast)        : null,
         result.maSlow        != null ? parseFloat(result.maSlow)        : null]
      );
    } catch (_) {}

    res.json({ success: true, symbol: symbol.toUpperCase(), strategy, dataSource, ...result });
  } catch (err) {
    logger.error(`[SignalCtrl] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/signal/regime/:symbol ───────────────────────────────────────────
// NEW ENDPOINT: Returns full regime detection result for a symbol.
// Useful for the frontend to display regime status independently.
async function getRegime(req, res) {
  try {
    const { symbol }  = req.params;
    const lookback    = parseInt(req.query.lookback || '250', 10);

    let bars = await dataStore.getRecentPrices(symbol.toUpperCase(), lookback);
    if (!bars || bars.length < 60) {
      const ub = await _upstoxBars(symbol.toUpperCase(), 60);
      if (ub) bars = ub;
    }
    if (!bars || bars.length < 60) {
      return res.status(422).json({
        success: false,
        error:   `Need ≥60 bars for regime detection, got ${bars?.length ?? 0} for ${symbol}`,
      });
    }

    const closes = bars.map(b => b.close);
    const regime  = detectRegimeWithRouting(closes, symbol.toUpperCase());

    res.json({ success: true, symbol: symbol.toUpperCase(), ...regime });
  } catch (err) {
    logger.error(`[SignalCtrl] getRegime: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/signal/history/:symbol ──────────────────────────────────────────
async function getSignalHistory(req, res) {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit || '50', 10);
    const [rows] = await db.query(
      'SELECT * FROM signals WHERE symbol = ? ORDER BY signal_ts DESC LIMIT ?',
      [symbol.toUpperCase(), limit]
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/signal/describe ──────────────────────────────────────────────────
function describeStrategies(req, res) {
  res.json({ success: true, data: strategyCore.describeWeights() });
}

module.exports = { getSignal, getRegime, getSignalHistory, describeStrategies };
