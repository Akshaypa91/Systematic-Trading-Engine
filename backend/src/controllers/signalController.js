// src/controllers/signalController.js
'use strict';

const dataStore  = require('../data/dataStore');
const aggregator = require('../strategies/aggregator');
const MR         = require('../strategies/meanReversion');
const MA         = require('../strategies/maCrossover');
const RSI        = require('../strategies/rsiStrategy');
const db         = require('../config/database');
const logger     = require('../config/logger');

async function getSignal(req, res) {
  try {
    const { symbol }   = req.params;
    const strategy     = (req.query.strategy || 'AGGREGATED').toUpperCase();
    const method       = req.query.method || 'weighted';
    const lookback     = parseInt(req.query.lookback || '250', 10);

    const bars = await dataStore.getRecentPrices(symbol.toUpperCase(), lookback);
    if (!bars || bars.length < 20) {
      return res.status(422).json({
        success: false,
        error:   `Insufficient data for ${symbol}: ${bars?.length ?? 0} bars found`,
      });
    }

    const closes = bars.map(b => b.close);
    let result;

    switch (strategy) {
      case 'MEAN_REVERSION': result = MR.generateSignal(closes); break;
      case 'MA_CROSSOVER':   result = MA.generateSignal(closes); break;
      case 'RSI':            result = RSI.generateSignal(closes); break;
      default:               result = aggregator.aggregate(closes, { method }); break;
    }

    try {
      await db.query(
        `INSERT INTO signals (symbol, signal_type, strategy, confidence, price_at_signal, z_score, rsi_value, ma_fast, ma_slow)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [symbol.toUpperCase(), result.signal, strategy, result.confidence,
         result.currentPrice ?? null, result.zScore ?? null, result.rsiValue ?? null,
         result.maFast ?? null, result.maSlow ?? null]
      );
    } catch (_) {}

    res.json({ success: true, symbol: symbol.toUpperCase(), strategy, ...result });
  } catch (err) {
    logger.error(`[SignalCtrl] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

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

function describeStrategies(req, res) {
  res.json({ success: true, data: aggregator.describeWeights() });
}

module.exports = { getSignal, getSignalHistory, describeStrategies };
