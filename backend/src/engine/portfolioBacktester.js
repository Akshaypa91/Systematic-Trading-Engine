// src/engine/portfolioBacktester.js
// ─────────────────────────────────────────────────────────────────────────────
// Multi-symbol, shared-capital backtest. Unlike the single-symbol backtester,
// this simulates the WHOLE book the way the live engine runs it: one capital
// pool, a max-concurrent-positions cap, per-trade sizing, and SL/TP exits — and
// it reuses the exact same decision components as live:
//   • strategyCore.evaluate  → the signal (identical to /signal + live)
//   • positionSizing.computeQty → the size (identical to live entries)
//   • the same SL/TP + concurrency rules as liveExecutionEngine
// So a portfolio backtest actually resembles live behaviour instead of an
// idealised single-name run. Pure (data in → results out); unit-tested.
//
// Model: iterate the union of trading dates. Each day, per open position check
// intrabar SL (bar.low ≤ stop) / TP (bar.high ≥ target) and exit; then, if the
// book has room and cash, evaluate BUY signals and open sized positions. Costs
// are a simple round-trip slippage applied to fills.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const strategyCore = require('./strategyCore');
const { computeQty } = require('../risk/positionSizing');

const _n = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function _sharpe(returns) {
  if (returns.length < 2) return 0;
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const v = returns.reduce((a, b) => a + (b - m) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(v);
  return sd > 0 ? +(m / sd * Math.sqrt(252)).toFixed(4) : 0;
}
function _maxDrawdown(equity) {
  let peak = -Infinity, mdd = 0;
  for (const e of equity) { if (e > peak) peak = e; const dd = peak > 0 ? (peak - e) / peak : 0; if (dd > mdd) mdd = dd; }
  return +(mdd * 100).toFixed(4);
}

/**
 * @param {object} args
 *   @param {Object<string, Array<{date,open,high,low,close}>>} args.series  per-symbol bars (ascending)
 *   @param {object} [args.config]
 * @returns {{summary, trades, equityCurve, bySymbol}}
 */
function runPortfolioBacktest({ series = {}, config = {} } = {}) {
  const {
    initialCapital = 1_000_000,
    strategy       = 'AGGREGATED',
    minConfidence  = 0.6,
    maxConcurrent  = 5,
    stopPct        = 0.02,
    takeProfitPct  = 0.04,
    sizingMethod   = 'risk',
    riskPerTrade   = 0.01,
    maxPositionValue = 0,
    slippagePct    = 0.0005,
    warmup         = 60,
    // takeProfitPct = 0 → NO profit target (let winners run).
    // exitOnSignal  = true → close when the strategy says SELL.
    exitOnSignal   = false,
  } = config;

  const symbols = Object.keys(series).filter(s => Array.isArray(series[s]) && series[s].length);
  if (symbols.length === 0) throw new Error('portfolio backtest requires at least one symbol series');

  // Per-symbol: date → index, and cached close arrays.
  const idxOf = {}, closesArr = {};
  for (const s of symbols) {
    const bars = series[s];
    idxOf[s] = new Map(bars.map((b, i) => [b.date, i]));
    closesArr[s] = bars.map(b => _n(b.close));
  }
  const allDates = [...new Set(symbols.flatMap(s => series[s].map(b => b.date)))].sort();

  let cash = initialCapital;
  const positions = {};   // sym → { qty, entry, sl, tp, entryDate }
  const trades = [];
  const equityCurve = [];
  const dailyReturns = [];
  const bySymbol = {};

  const barAt = (s, date) => { const i = idxOf[s].get(date); return i == null ? null : series[s][i]; };

  for (const date of allDates) {
    // 1. Exits — intrabar SL/TP, then the strategy's own SELL signal.
    for (const s of Object.keys(positions)) {
      const bar = barAt(s, date); if (!bar) continue;
      const p = positions[s];
      let exitPrice = null, reason = null;
      if (_n(bar.low) > 0 && _n(bar.low) <= p.sl)  { exitPrice = p.sl; reason = 'STOP_LOSS'; }
      else if (p.tp > 0 && _n(bar.high) >= p.tp)   { exitPrice = p.tp; reason = 'TAKE_PROFIT'; }
      else if (exitOnSignal) {
        // Signal-based exit. Without this a trend-following strategy can never
        // express its edge — "ride the trend, exit when it breaks" IS the
        // strategy; forcing it to exit at a fixed % truncates every winner.
        const i = idxOf[s].get(date);
        if (i != null && i >= warmup) {
          const sig = strategyCore.evaluate(strategy, closesArr[s].slice(0, i + 1), { method: 'weighted' });
          if (sig.signal === 'SELL') { exitPrice = _n(bar.close); reason = 'SIGNAL_EXIT'; }
        }
      }
      if (exitPrice != null) {
        const fill = exitPrice * (1 - slippagePct);
        cash += p.qty * fill;
        const pnl = (fill - p.entry) * p.qty;
        trades.push({ symbol: s, entryDate: p.entryDate, exitDate: date, entryPrice: +p.entry.toFixed(4),
          exitPrice: +fill.toFixed(4), qty: p.qty, pnl: +pnl.toFixed(2), reason });
        bySymbol[s] = (bySymbol[s] || 0) + pnl;
        delete positions[s];
      }
    }

    // 2. Entries (respect concurrency + capital).
    for (const s of symbols) {
      if (Object.keys(positions).length >= maxConcurrent) break;
      if (positions[s]) continue;
      const i = idxOf[s].get(date);
      if (i == null || i < warmup) continue;
      const closes = closesArr[s].slice(0, i + 1);
      const sig = strategyCore.evaluate(strategy, closes, { method: 'weighted' });
      if (sig.signal !== 'BUY' || !(_n(sig.confidence) >= minConfidence)) continue;
      const price = closes[closes.length - 1];
      const qty = computeQty({ method: sizingMethod, price, capital: cash, riskPerTrade, stopPct, fixedQty: 1, maxPositionValue });
      if (!(qty > 0)) continue;
      const fill = price * (1 + slippagePct);
      const cost = qty * fill;
      if (cost > cash) continue;
      cash -= cost;
      // tp = 0 means "no target" — the position exits on stop or signal only.
      positions[s] = { qty, entry: fill, sl: fill * (1 - stopPct),
        tp: takeProfitPct > 0 ? fill * (1 + takeProfitPct) : 0, entryDate: date };
    }

    // 3. Mark to market.
    let mtm = 0;
    for (const s of Object.keys(positions)) { const bar = barAt(s, date); if (bar) mtm += positions[s].qty * _n(bar.close); }
    const equity = cash + mtm;
    equityCurve.push({ date, equity: +equity.toFixed(2) });
    if (equityCurve.length >= 2) {
      const prev = equityCurve[equityCurve.length - 2].equity;
      dailyReturns.push(prev > 0 ? (equity - prev) / prev : 0);
    }
  }

  // Force-close remaining positions at the last available close.
  const lastDate = allDates[allDates.length - 1];
  for (const s of Object.keys(positions)) {
    const p = positions[s];
    const bar = barAt(s, lastDate) || series[s][series[s].length - 1];
    const fill = _n(bar.close) * (1 - slippagePct);
    cash += p.qty * fill;
    const pnl = (fill - p.entry) * p.qty;
    trades.push({ symbol: s, entryDate: p.entryDate, exitDate: lastDate, entryPrice: +p.entry.toFixed(4),
      exitPrice: +fill.toFixed(4), qty: p.qty, pnl: +pnl.toFixed(2), reason: 'END_OF_DATA' });
    bySymbol[s] = (bySymbol[s] || 0) + pnl;
    delete positions[s];
  }

  const finalEquity = cash;
  const wins = trades.filter(t => t.pnl > 0);
  const eqVals = equityCurve.map(e => e.equity);
  const summary = {
    symbols, initialCapital, finalCapital: +finalEquity.toFixed(2),
    totalReturnPct: +(((finalEquity - initialCapital) / initialCapital) * 100).toFixed(4),
    sharpeRatio: _sharpe(dailyReturns),
    maxDrawdownPct: _maxDrawdown(eqVals),
    totalTrades: trades.length,
    winningTrades: wins.length,
    winRatePct: trades.length ? +((wins.length / trades.length) * 100).toFixed(2) : 0,
    maxConcurrent, sizingMethod,
    bySymbol: Object.fromEntries(Object.entries(bySymbol).map(([k, v]) => [k, +v.toFixed(2)])),
  };
  return { summary, trades, equityCurve };
}

module.exports = { runPortfolioBacktest };
