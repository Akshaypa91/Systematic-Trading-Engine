// src/analytics/portfolioMetrics.js
// Advanced quant metrics for backtest results
'use strict';

const db = require('../config/database');

// ── Basic helpers ─────────────────────────────────────────────────────────────

function annualizeFactor(days) {
  return 252 / Math.max(days, 1);
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  const m   = mean(arr);
  const sq  = arr.map(x => (x - m) ** 2);
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / arr.length);
}

// ── CAGR ─────────────────────────────────────────────────────────────────────
function calcCAGR(initialCapital, finalCapital, tradingDays) {
  if (initialCapital <= 0 || tradingDays <= 0) return 0;
  const years = tradingDays / 252;
  return parseFloat(((Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100).toFixed(4));
}

// ── Sharpe Ratio ─────────────────────────────────────────────────────────────
// riskFreeRate: annualised (e.g. 0.065 = 6.5% India)
function calcSharpe(dailyReturns, riskFreeRate = 0.065) {
  if (!dailyReturns || dailyReturns.length < 2) return 0;
  const rfDaily  = riskFreeRate / 252;
  const excess   = dailyReturns.map(r => r - rfDaily);
  const avgEx    = mean(excess);
  const vol      = stdDev(excess);
  if (vol === 0) return 0;
  return parseFloat(((avgEx / vol) * Math.sqrt(252)).toFixed(4));
}

// ── Sortino Ratio ─────────────────────────────────────────────────────────────
// Only penalises downside volatility (smarter than Sharpe for trading)
function calcSortino(dailyReturns, riskFreeRate = 0.065) {
  if (!dailyReturns || dailyReturns.length < 2) return 0;
  const rfDaily     = riskFreeRate / 252;
  const excess      = dailyReturns.map(r => r - rfDaily);
  const avgEx       = mean(excess);
  const downside    = excess.filter(r => r < 0);
  if (downside.length === 0) return avgEx > 0 ? 99 : 0;
  const downsideVol = Math.sqrt(downside.map(r => r ** 2).reduce((a, b) => a + b, 0) / downside.length);
  const annVol      = downsideVol * Math.sqrt(252);
  if (annVol === 0) return 0;
  return parseFloat(((avgEx * 252) / annVol).toFixed(4));
}

// ── Max Drawdown ──────────────────────────────────────────────────────────────
function calcMaxDrawdown(equityCurve) {
  if (!equityCurve || equityCurve.length < 2) return { maxDrawdown: 0, drawdownPct: 0 };
  let peak        = equityCurve[0];
  let maxDD       = 0;
  let ddPct       = 0;
  for (const val of equityCurve) {
    if (val > peak) peak = val;
    const dd = (peak - val) / peak;
    if (dd > ddPct) { ddPct = dd; maxDD = peak - val; }
  }
  return {
    maxDrawdown:    parseFloat(maxDD.toFixed(2)),
    maxDrawdownPct: parseFloat((ddPct * 100).toFixed(4)),
  };
}

// ── Calmar Ratio ─────────────────────────────────────────────────────────────
function calcCalmar(cagr, maxDrawdownPct) {
  if (maxDrawdownPct <= 0) return cagr > 0 ? 99 : 0;
  return parseFloat((cagr / maxDrawdownPct).toFixed(4));
}

// ── Volatility (annualised) ───────────────────────────────────────────────────
function calcVolatility(dailyReturns) {
  if (!dailyReturns || dailyReturns.length < 2) return 0;
  return parseFloat((stdDev(dailyReturns) * Math.sqrt(252) * 100).toFixed(4));
}

// ── Win Rate & Profit Factor ──────────────────────────────────────────────────
function calcTradeStats(trades) {
  if (!trades || trades.length === 0) {
    return { winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0 };
  }
  const closed   = trades.filter(t => t.pnl != null);
  const wins     = closed.filter(t => t.pnl > 0);
  const losses   = closed.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin   = wins.length   ? grossWin / wins.length   : 0;
  const avgLoss  = losses.length ? grossLoss / losses.length : 0;
  const winRate  = closed.length ? wins.length / closed.length : 0;

  return {
    totalTrades:  closed.length,
    winCount:     wins.length,
    lossCount:    losses.length,
    winRate:      parseFloat((winRate * 100).toFixed(2)),
    profitFactor: grossLoss > 0 ? parseFloat((grossWin / grossLoss).toFixed(4)) : grossWin > 0 ? 99 : 0,
    avgWin:       parseFloat(avgWin.toFixed(2)),
    avgLoss:      parseFloat(avgLoss.toFixed(2)),
    grossProfit:  parseFloat(grossWin.toFixed(2)),
    grossLoss:    parseFloat(grossLoss.toFixed(2)),
    expectancy:   parseFloat((winRate * avgWin - (1 - winRate) * avgLoss).toFixed(2)),
  };
}

// ── Daily returns from equity curve ──────────────────────────────────────────
function equityToDailyReturns(equityCurve) {
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i-1] > 0) {
      returns.push((equityCurve[i] - equityCurve[i-1]) / equityCurve[i-1]);
    }
  }
  return returns;
}

// ── Benchmark comparison (Nifty 50) ──────────────────────────────────────────
async function getBenchmarkReturn(startDate, endDate) {
  try {
    const [rows] = await db.query(
      `SELECT close FROM daily_prices
       WHERE symbol = 'NIFTY50' AND date BETWEEN ? AND ?
       ORDER BY date`,
      [startDate, endDate]
    );
    if (rows.length < 2) return null;
    const ret = (rows[rows.length-1].close - rows[0].close) / rows[0].close * 100;
    return parseFloat(ret.toFixed(4));
  } catch { return null; }
}

// ── Full metrics bundle ───────────────────────────────────────────────────────
async function computeFullMetrics({ equityCurve, trades, initialCapital, startDate, endDate }) {
  const finalCapital  = equityCurve[equityCurve.length - 1] || initialCapital;
  const tradingDays   = equityCurve.length;
  const dailyReturns  = equityToDailyReturns(equityCurve);
  const { maxDrawdown, maxDrawdownPct } = calcMaxDrawdown(equityCurve);
  const cagr          = calcCAGR(initialCapital, finalCapital, tradingDays);
  const sharpe        = calcSharpe(dailyReturns);
  const sortino       = calcSortino(dailyReturns);
  const calmar        = calcCalmar(cagr, maxDrawdownPct);
  const volatility    = calcVolatility(dailyReturns);
  const tradeStats    = calcTradeStats(trades);
  const totalReturn   = parseFloat(((finalCapital - initialCapital) / initialCapital * 100).toFixed(4));
  const benchmark     = await getBenchmarkReturn(startDate, endDate);
  const alpha         = benchmark != null ? parseFloat((totalReturn - benchmark).toFixed(4)) : null;

  return {
    totalReturn,
    cagr,
    sharpe,
    sortino,
    calmar,
    maxDrawdown,
    maxDrawdownPct,
    volatility,
    alpha,
    benchmarkReturn: benchmark,
    ...tradeStats,
    initialCapital,
    finalCapital: parseFloat(finalCapital.toFixed(2)),
    tradingDays,
  };
}

module.exports = {
  calcCAGR, calcSharpe, calcSortino, calcMaxDrawdown,
  calcCalmar, calcVolatility, calcTradeStats,
  equityToDailyReturns, getBenchmarkReturn, computeFullMetrics,
};
