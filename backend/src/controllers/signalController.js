// src/controllers/signalController.js — REGIME-AWARE UPGRADE
'use strict';

const dataStore  = require('../data/dataStore');
const aggregator = require('../strategies/aggregator');
const MR         = require('../strategies/meanReversion');
const MA         = require('../strategies/maCrossover');
const RSI        = require('../strategies/rsiStrategy');
const BB         = require('../strategies/bollingerBands');
const { detectRegimeWithRouting, resetSmoothing } = require('../engine/regimeDetector');
const signalEngine = require('../engine/signalEngine');
const simEngine    = require('../engine/simulationEngine');
const marketData   = require('../services/marketDataService');
const db         = require('../config/database');
const logger     = require('../config/logger');

// Real-market fallback: when the local DB has too few bars, pull daily candles
// straight from Upstox (only works when a broker session is live) so signals
// are computed on real prices instead of falling through to the sim engine.
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

    // ── Sim fallback: DB empty and no broker candles → simulation engine ──────
    if (!bars || bars.length < 20) {
      logger.info(`[SignalCtrl] No real data for ${symbol} (${bars?.length ?? 0} bars) — falling back to sim engine`);

      // Ensure sim engine has generated history for this symbol
      simEngine.addSymbol(symbol.toUpperCase());
      const simPrices = simEngine.getPriceHistory(symbol.toUpperCase());

      if (!simPrices || simPrices.length < 51) {
        return res.status(422).json({
          success: false,
          error:   `Insufficient data for ${symbol}: ${bars?.length ?? 0} bars in DB, sim engine not ready yet — retry in a few seconds`,
        });
      }

      // Use signalEngine directly on simulated prices
      const sig = signalEngine.computeSignal(symbol.toUpperCase(), simPrices);
      return res.json({
        success:      true,
        symbol:       symbol.toUpperCase(),
        strategy:     'SIM_FALLBACK',
        signal:       sig.signal,
        confidence:   sig.confidence,
        currentPrice: sig.currentPrice,
        rsiValue:     sig.rsi,
        maFast:       sig.sma20,
        maSlow:       sig.sma50,
        bbUpper:      sig.bbUpper,
        bbLower:      sig.bbLower,
        zScore:       null,
        components:   sig.components,
        score:        sig.score,
        simMode:      true,
        timestamp:    sig.timestamp,
      });
    }

    const closes = bars.map(b => b.close);
    let result;

    switch (strategy) {
      case 'MEAN_REVERSION': result = MR.generateSignal(closes);  break;
      case 'MA_CROSSOVER':   result = MA.generateSignal(closes);  break;
      case 'RSI':            result = RSI.generateSignal(closes); break;
      case 'BOLLINGER':      result = BB.generateSignal(closes, {
        mode: req.query.bbMode || 'mean_reversion',
      }); break;
      default:               result = aggregator.aggregate(closes, {
        method, symbol: symbol.toUpperCase(), useRegime,
      }); break;
    }

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
  res.json({ success: true, data: aggregator.describeWeights() });
}

module.exports = { getSignal, getRegime, getSignalHistory, describeStrategies };
