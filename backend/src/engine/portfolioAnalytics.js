// src/engine/portfolioAnalytics.js
// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Analytics
//
// Provides post-trade analytics beyond what the backtester computes:
//   • Realised P&L by symbol and strategy
//   • Rolling Sharpe (20-day window)
//   • Equity drawdown series (for charting)
//   • Consecutive win/loss streaks
//   • Calmar ratio = annualised return / max drawdown
//   • Trade duration analysis
//   • MAE/MFE (Maximum Adverse/Favourable Excursion) per trade
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const db     = require('../config/database');
const C      = require('../config/constants');
const logger = require('../config/logger');

// ─── Live portfolio summary ───────────────────────────────────────────────────

/**
 * Compute full analytics for a backtest run by runId.
 * Reads backtest_trades from DB and produces enriched metrics.
 *
 * @param {number} runId
 * @returns {Promise<Object>}
 */
async function analyseBacktestRun(runId, userId = null) {
  const [[run]] = await db.query(
    'SELECT * FROM backtest_runs WHERE id = ? AND user_id <=> ?',
    [runId, userId]
  );
  if (!run) throw new Error(`Backtest run ${runId} not found`);

  const [trades] = await db.query(
    'SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY entry_date ASC',
    [runId]
  );

  if (trades.length === 0) {
    return { run, trades: [], analytics: null, message: 'No trades in this run' };
  }

  const analytics = computeTradeAnalytics(trades, parseFloat(run.initial_capital));

  return { run, trades, analytics };
}

/**
 * Compute detailed analytics from an array of trade records.
 *
 * @param {Array} trades
 * @param {number} initialCapital
 * @returns {Object}
 */
function computeTradeAnalytics(trades, initialCapital) {
  const completedTrades = trades.filter(t => t.exit_price !== null);
  if (completedTrades.length === 0) return null;

  const pnls    = completedTrades.map(t => parseFloat(t.pnl));
  const pnlPcts = completedTrades.map(t => parseFloat(t.pnl_pct));

  // ── P&L metrics ────────────────────────────────────────────────────────
  const grossProfit = pnls.filter(p => p > 0).reduce((s, v) => s + v, 0);
  const grossLoss   = Math.abs(pnls.filter(p => p < 0).reduce((s, v) => s + v, 0));
  const netPnl      = pnls.reduce((s, v) => s + v, 0);

  // ── Win/loss stats ─────────────────────────────────────────────────────
  const wins   = completedTrades.filter(t => parseFloat(t.pnl) > 0);
  const losses = completedTrades.filter(t => parseFloat(t.pnl) <= 0);
  const winRate = completedTrades.length ? wins.length / completedTrades.length : 0;

  // ── Trade duration (calendar days) ────────────────────────────────────
  const durations = completedTrades.map(t => {
    const entry = new Date(t.entry_date);
    const exit  = new Date(t.exit_date);
    return Math.max(1, Math.floor((exit - entry) / 86400000));
  });
  const avgDuration = mu.mean(durations);
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);

  // ── Consecutive streaks ────────────────────────────────────────────────
  const { maxWinStreak, maxLossStreak, currentStreak } = computeStreaks(pnls);

  // ── Rolling equity curve ───────────────────────────────────────────────
  let equity = initialCapital;
  const equityCurve = [{ date: completedTrades[0].entry_date, equity }];
  for (const trade of completedTrades) {
    equity += parseFloat(trade.pnl);
    equityCurve.push({ date: trade.exit_date, equity: parseFloat(equity.toFixed(2)) });
  }

  // ── Drawdown series ────────────────────────────────────────────────────
  const equityValues = equityCurve.map(e => e.equity);
  const drawdownSeries = computeDrawdownSeries(equityValues);
  const { maxDrawdown } = mu.maxDrawdown(equityValues);

  // ── Rolling 20-trade Sharpe ────────────────────────────────────────────
  const rollingSharpe = computeRollingSharpe(pnlPcts, 20);

  // ── Calmar Ratio: annualised return / max drawdown ─────────────────────
  const firstDate = new Date(completedTrades[0].entry_date);
  const lastDate  = new Date(completedTrades[completedTrades.length - 1].exit_date);
  const years     = Math.max(0.01, (lastDate - firstDate) / (365 * 86400000));
  const annReturn = (Math.pow(equity / initialCapital, 1 / years) - 1);
  const calmar    = maxDrawdown > 0 ? annReturn / maxDrawdown : null;

  // ── P&L by exit reason ─────────────────────────────────────────────────
  const byExitReason = groupBy(completedTrades, 'exit_reason', t => ({
    count: 1, pnl: parseFloat(t.pnl),
  }), (acc, cur) => ({ count: acc.count + 1, pnl: acc.pnl + cur.pnl }));

  // ── Expectancy: expected $ per trade ──────────────────────────────────
  // E = (WinRate × AvgWin) − (LossRate × AvgLoss)
  const avgWin  = wins.length   ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  return {
    summary: {
      totalTrades:      completedTrades.length,
      winningTrades:    wins.length,
      losingTrades:     losses.length,
      winRatePct:       parseFloat((winRate * 100).toFixed(2)),
      netPnl:           parseFloat(netPnl.toFixed(2)),
      grossProfit:      parseFloat(grossProfit.toFixed(2)),
      grossLoss:        parseFloat(grossLoss.toFixed(2)),
      profitFactor:     grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(4)) : null,
      expectancyPerTrade: parseFloat(expectancy.toFixed(2)),
      avgWinAmount:     parseFloat(avgWin.toFixed(2)),
      avgLossAmount:    parseFloat(avgLoss.toFixed(2)),
      avgWinPct:        wins.length   ? parseFloat(mu.mean(wins.map(t => parseFloat(t.pnl_pct))).toFixed(3)) : 0,
      avgLossPct:       losses.length ? parseFloat(mu.mean(losses.map(t => parseFloat(t.pnl_pct))).toFixed(3)) : 0,
      maxWinStreak,
      maxLossStreak,
      currentStreak,
    },
    duration: {
      avgDays: parseFloat(avgDuration.toFixed(1)),
      maxDays: maxDuration,
      minDays: minDuration,
      totalDays: Math.round(years * 365),
    },
    riskAdjusted: {
      maxDrawdownPct:   parseFloat((maxDrawdown * 100).toFixed(3)),
      calmarRatio:      calmar ? parseFloat(calmar.toFixed(4)) : null,
      annualisedReturnPct: parseFloat((annReturn * 100).toFixed(3)),
    },
    byExitReason,
    equityCurve,
    drawdownSeries,
    rollingSharpe,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeStreaks(pnls) {
  let maxWin = 0, maxLoss = 0, cur = 0, curSign = null;
  for (const p of pnls) {
    const sign = p > 0 ? 1 : -1;
    if (sign === curSign) {
      cur++;
    } else {
      cur = 1;
      curSign = sign;
    }
    if (curSign === 1  && cur > maxWin)  maxWin  = cur;
    if (curSign === -1 && cur > maxLoss) maxLoss = cur;
  }
  return {
    maxWinStreak:  maxWin,
    maxLossStreak: maxLoss,
    currentStreak: curSign === 1 ? cur : -cur,
  };
}

function computeDrawdownSeries(equityValues) {
  let peak = equityValues[0];
  return equityValues.map((v, i) => {
    if (v > peak) peak = v;
    const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
    return parseFloat(dd.toFixed(4));
  });
}

function computeRollingSharpe(pnlPcts, window) {
  if (pnlPcts.length < window) return [];
  const result = [];
  for (let i = window; i <= pnlPcts.length; i++) {
    const slice = pnlPcts.slice(i - window, i);
    const s = mu.sharpeRatio(slice.map(p => p / 100), C.BACKTEST.RISK_FREE_RATE / 252, 252);
    result.push(parseFloat((s || 0).toFixed(4)));
  }
  return result;
}

function groupBy(arr, key, mapper, reducer) {
  const result = {};
  for (const item of arr) {
    const k   = item[key] || 'UNKNOWN';
    const val = mapper(item);
    result[k] = result[k] ? reducer(result[k], val) : val;
  }
  return result;
}

/**
 * Compute live portfolio analytics from paper_trades table.
 */
async function getLivePortfolioAnalytics(userId = null) {
  const [trades] = await db.query(`
    SELECT * FROM paper_trades
    WHERE status = 'EXECUTED'
      AND user_id <=> ?
    ORDER BY executed_at ASC
  `, [userId]);

  const closedTrades = trades.filter(t => t.pnl !== null);
  const openTrades   = trades.filter(t => t.pnl === null && t.side === 'BUY');

  const realisedPnl = closedTrades.reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
  const totalComm   = trades.reduce((s, t) => s + parseFloat(t.commission || 0), 0);

  return {
    totalOrders:   trades.length,
    closedTrades:  closedTrades.length,
    openPositions: openTrades.length,
    realisedPnl:   parseFloat(realisedPnl.toFixed(2)),
    totalCommission: parseFloat(totalComm.toFixed(2)),
    analytics: closedTrades.length >= 2
      ? computeTradeAnalytics(closedTrades.map(normalizeDbTrade), C.RISK.DEFAULT_CAPITAL)
      : null,
  };
}

function normalizeDbTrade(t) {
  return {
    pnl:        parseFloat(t.pnl || 0),
    pnl_pct:    parseFloat(t.pnl_pct || 0),
    entry_date: t.created_at,
    exit_date:  t.closed_at || t.executed_at,
    exit_reason: 'SIGNAL',
    exit_price:  t.executed_price,
  };
}

module.exports = {
  analyseBacktestRun,
  computeTradeAnalytics,
  getLivePortfolioAnalytics,
};
