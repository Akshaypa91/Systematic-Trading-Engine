// src/controllers/backtestController.js
'use strict';

const dataStore  = require('../data/dataStore');
const backtester = require('../engine/backtester');
const db         = require('../config/database');
const logger     = require('../config/logger');

// Lazy-load to avoid circular deps
let _marketData = null;
function getMarketData() {
  if (!_marketData) _marketData = require('../services/marketDataService');
  return _marketData;
}

function buildValuesPlaceholders(rows, width) {
  return rows
    .map(() => `(${Array.from({ length: width }, () => '?').join(',')})`)
    .join(',');
}

/**
 * POST /api/backtest
 * Body: { symbol, strategy, startDate, endDate, initialCapital,
 *         stopLossPct, takeProfitPct, riskPerTrade, aggrMethod }
 */
async function runBacktest(req, res) {
  try {
    const userId = req.user?.userId ?? req.user?.id ?? null;
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

    let prices = await dataStore.getDailyPrices(symbol.toUpperCase(), {
      startDate: startDate || null,
      endDate:   endDate   || null,
    });

    if (!prices || prices.length < 201) {
      // Try to fetch historical data automatically before giving up
      logger.info(`[Backtest] Insufficient data for ${symbol} (${prices?.length ?? 0} bars) — attempting auto-fetch`);
      try {
        const twelveKey = process.env.TWELVEDATA_API_KEY;
        if (!twelveKey) throw new Error('No TWELVEDATA_API_KEY');

        const axios = require('axios');
        const sym   = `${symbol}:NSE`;
        const res   = await axios.get('https://api.twelvedata.com/time_series', {
          params: { symbol: sym, interval: '1day', outputsize: 5000, apikey: twelveKey },
          timeout: 15000,
        });

        const values = res.data?.values;
        if (Array.isArray(values) && values.length > 0) {
          // Save to DB
          const rows = values.map(v => ({
            symbol: symbol.toUpperCase(),
            date:   v.datetime,
            open:   parseFloat(v.open),
            high:   parseFloat(v.high),
            low:    parseFloat(v.low),
            close:  parseFloat(v.close),
            volume: parseInt(v.volume || 0, 10),
          }));
          await dataStore.saveDailyPrices(rows);
          logger.info(`[Backtest] Auto-fetched ${rows.length} bars for ${symbol}`);

          // Re-query
          prices = await dataStore.getDailyPrices(symbol.toUpperCase(), {
            startDate: startDate || null,
            endDate:   endDate   || null,
          });
        }
      } catch (fetchErr) {
        logger.warn(`[Backtest] Auto-fetch failed for ${symbol}: ${fetchErr.message}`);
      }

      // Still not enough — return clear error
      if (!prices || prices.length < 201) {
        return res.status(422).json({
          success: false,
          error:   `Not enough price history for ${symbol}. Found ${prices?.length ?? 0} bars, need 201+. ` +
                   `Use POST /api/data/fetch-and-store/${symbol} to seed data first.`,
          hint:    `POST /api/data/fetch-and-store/${symbol}`,
        });
      }
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
      const [, runResult] = await db.query(`
        INSERT INTO backtest_runs
          (user_id, symbol, strategy, start_date, end_date, initial_capital, final_capital,
           total_return_pct, annualised_return_pct, sharpe_ratio, max_drawdown_pct,
           win_rate_pct, total_trades, winning_trades, losing_trades,
           avg_profit_pct, avg_loss_pct, profit_factor, parameters)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        userId,
        summary.symbol, summary.strategy, summary.startDate, summary.endDate,
        summary.initialCapital, summary.finalCapital, summary.totalReturnPct,
        summary.annualisedReturnPct, summary.sharpeRatio, summary.maxDrawdownPct,
        summary.winRatePct, summary.totalTrades, summary.winningTrades, summary.losingTrades,
        summary.avgWinPct, summary.avgLossPct, summary.profitFactor,
        JSON.stringify({ stopLossPct, takeProfitPct, riskPerTrade }),
      ]);
      runId = runResult.insertId;

      // FIX Bug 14: Persist individual trades — were NEVER inserted, causing
      // GET /api/backtest/runs/:id/trades and analytics to always return empty.
      if (runId && trades.length > 0) {
        const tradeRows = trades.map(t => [
          runId, t.symbol, t.side,
          t.entryDate, t.entryPrice,
          t.exitDate  ?? null, t.exitPrice ?? null,
          t.quantity,
          t.pnl       ?? null, t.pnlPct    ?? null,
          t.commission ?? 0,   t.slippageCost ?? 0,
          t.exitReason ?? 'SIGNAL',
          t.regime    ?? null,
        ]);
        const width = 14;
        await db.query(`
          INSERT INTO backtest_trades
            (run_id, symbol, side, entry_date, entry_price,
             exit_date, exit_price, quantity, pnl, pnl_pct,
             commission, slippage, exit_reason, regime)
          VALUES ${buildValuesPlaceholders(tradeRows, width)}
        `, tradeRows.flat());
      }
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
    const userId = req.user?.userId ?? req.user?.id ?? null;
    const { symbol, limit = 10 } = req.query;
    let sql    = 'SELECT * FROM backtest_runs WHERE user_id <=> ?';
    const params = [userId];
    if (symbol) { sql += ' AND symbol = ?'; params.push(symbol.toUpperCase()); }
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
    const userId = req.user?.userId ?? req.user?.id ?? null;
    const { runId } = req.params;
    const [rows] = await db.query(
      `SELECT bt.*
       FROM backtest_trades bt
       JOIN backtest_runs br ON br.id = bt.run_id
       WHERE bt.run_id = ? AND br.user_id <=> ?
       ORDER BY bt.entry_date ASC`,
      [runId, userId]
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { runBacktest, getBacktestRuns, getBacktestTrades };
