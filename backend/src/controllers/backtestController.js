// src/controllers/backtestController.js
'use strict';

const dataStore  = require('../data/dataStore');
const backtester = require('../engine/backtester');
const db         = require('../config/database');
const logger     = require('../config/logger');

/**
 * POST /api/backtest
 * Body: { symbol, strategy, startDate, endDate, initialCapital,
 *         stopLossPct, takeProfitPct, riskPerTrade, aggrMethod }
 */
async function runBacktest(req, res) {
  try {
    const {
      symbol,
      strategy      = 'AGGREGATED',
      startDate,
      endDate,
      initialCapital= 1000000,
      stopLossPct   = 0.02,
      takeProfitPct = 0.04,
      riskPerTrade  = 0.02,
      aggrMethod    = 'weighted',
    } = req.body;

    if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

    const prices = await dataStore.getDailyPrices(symbol.toUpperCase(), {
      startDate: startDate || null,
      endDate:   endDate   || null,
    });

    if (!prices || prices.length < 201) {
      return res.status(422).json({
        success: false,
        error: `Need at least 201 price bars, found ${prices?.length ?? 0} for ${symbol}`,
      });
    }

    const { summary, trades, equityCurve } = backtester.runBacktest({
      symbol: symbol.toUpperCase(),
      prices,
      initialCapital: parseFloat(initialCapital),
      stopLossPct:    parseFloat(stopLossPct),
      takeProfitPct:  parseFloat(takeProfitPct),
      riskPerTrade:   parseFloat(riskPerTrade),
      strategy:       strategy.toUpperCase(),
      aggrMethod,
    });

    // Persist run summary
    let runId = null;
    try {
      const [result] = await db.query(`
        INSERT INTO backtest_runs
          (symbol, strategy, start_date, end_date, initial_capital, final_capital,
           total_return_pct, annualised_return_pct, sharpe_ratio, max_drawdown_pct,
           win_rate_pct, total_trades, winning_trades, losing_trades,
           avg_profit_pct, avg_loss_pct, profit_factor, parameters)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        summary.symbol, summary.strategy, summary.startDate, summary.endDate,
        summary.initialCapital, summary.finalCapital, summary.totalReturnPct,
        summary.annualisedReturnPct, summary.sharpeRatio, summary.maxDrawdownPct,
        summary.winRatePct, summary.totalTrades, summary.winningTrades, summary.losingTrades,
        summary.avgWinPct, summary.avgLossPct, summary.profitFactor,
        JSON.stringify({ stopLossPct, takeProfitPct, riskPerTrade }),
      ]);
      runId = result.insertId;
    } catch (dbErr) {
      logger.warn(`[BtCtrl] DB persist failed: ${dbErr.message}`);
    }

    res.json({
      success: true,
      runId,
      summary,
      trades,
      equityCurveLength: equityCurve.length,
      // Step-5 downsample — consistent with walk-forward optimizer output
      equityCurveSample: equityCurve
        .filter((_, i) => i % 5 === 0)
        .map(v => parseFloat(v.toFixed(2))),
    });
  } catch (err) {
    logger.error(`[BtCtrl] runBacktest error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/backtest/runs?symbol=RELIANCE&limit=10
 */
async function getBacktestRuns(req, res) {
  try {
    const { symbol, limit = 10 } = req.query;
    let sql    = 'SELECT * FROM backtest_runs';
    const params = [];
    if (symbol) { sql += ' WHERE symbol = ?'; params.push(symbol.toUpperCase()); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10));
    const [rows] = await db.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/backtest/runs/:runId/trades
 */
async function getBacktestTrades(req, res) {
  try {
    const { runId } = req.params;
    const [rows] = await db.query(
      'SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY entry_date ASC',
      [runId]
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { runBacktest, getBacktestRuns, getBacktestTrades };
