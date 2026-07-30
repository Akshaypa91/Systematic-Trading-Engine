// src/controllers/backtestController.js
'use strict';

const dataStore  = require('../data/dataStore');
const backtester = require('../engine/backtester');
const { runPortfolioBacktest } = require('../engine/portfolioBacktester');
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

// ── POST /api/backtest/portfolio ──────────────────────────────────────────────
// Multi-symbol shared-capital backtest mirroring the live engine. Fetches
// corporate-action-ADJUSTED daily candles per symbol, then runs the portfolio
// engine (strategyCore + positionSizing + concurrency + SL/TP).
async function runPortfolio(req, res) {
  const { symbols, ...config } = req.body || {};
  const syms = Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()).slice(0, 25) : [];
  if (syms.length < 1) return res.status(400).json({ success: false, error: 'symbols[] required (1–25)' });

  try {
    const md = getMarketData();
    const series = {};
    for (const sym of syms) {
      try {
        const cd = await md.getCandles(sym, { interval: 'day', days: 500 });
        const candles = (cd?.candles || []).map(c => ({ date: String(c.t).slice(0, 10), open: c.o, high: c.h, low: c.l, close: c.c }));
        if (candles.length >= 60) series[sym] = candles;
      } catch (e) { logger.debug(`[PortfolioBT] ${sym}: ${e.message}`); }
    }
    if (Object.keys(series).length === 0)
      return res.status(422).json({ success: false, error: 'No symbol had ≥60 daily bars (broker session may be required)' });

    const result = runPortfolioBacktest({ series, config });
    return res.json({ success: true, ...result, skipped: syms.filter(s => !series[s]) });
  } catch (err) {
    logger.error(`[PortfolioBT] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/backtest/intraday ───────────────────────────────────────────────
// 1-minute VWAP scalper backtest. Returns gross → costs → net separately,
// because for a high-turnover strategy the frictions are the headline number.
async function runIntraday(req, res) {
  const { symbols, costBps } = req.body || {};
  const syms = Array.isArray(symbols) && symbols.length
    ? symbols.map(s => String(s).toUpperCase()).slice(0, 10)
    : ['RELIANCE', 'TCS', 'HDFCBANK'];
  try {
    const md = getMarketData();
    const engine = require('../engine/intradayBacktester');
    const series = {};
    const skipped = [];
    for (const sym of syms) {
      try {
        const cd = await md.getCandles(sym, { interval: '1minute', days: 30 });
        const bars = (cd?.candles || [])
          .map(k => ({ date: String(k.t), open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }))
          .filter(b => Number.isFinite(b.close));
        if (bars.length >= 200) series[sym] = bars; else skipped.push(sym);
      } catch (e) { skipped.push(sym); logger.debug(`[IntradayBT] ${sym}: ${e.message}`); }
    }
    if (!Object.keys(series).length) {
      return res.status(422).json({ success: false, error: 'No symbol had ≥200 one-minute bars (a broker session is required).', skipped });
    }
    const result = engine.run(series, { costBps: Number(costBps) || 18 });
    return res.json({ success: true, ...result, skipped });
  } catch (err) {
    logger.error(`[IntradayBT] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { runBacktest, runPortfolio, runIntraday, getBacktestRuns, getBacktestTrades };
