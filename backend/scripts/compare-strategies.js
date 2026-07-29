// scripts/compare-strategies.js
// Runs several strategies over the SAME data with the SAME costs and prints a
// side-by-side table. Purpose: replace "this strategy is better" opinions with
// measured numbers, using the portfolio backtester (shared capital, the same
// sizing/exit logic the live engine uses).
//
//   node scripts/compare-strategies.js                # synthetic data (offline)
//   node scripts/compare-strategies.js --real RELIANCE TCS INFY   # needs broker
//
// NOTE: synthetic data only shows how a strategy BEHAVES (trend-capture vs
// dip-buying). Only the --real run on your own history is evidence about your
// market. Neither is a promise of future profit.
'use strict';
require('dotenv').config();

const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {}; logger.warn = () => {};

const { runPortfolioBacktest } = require('../src/engine/portfolioBacktester');

const STRATEGIES = ['AGGREGATED', 'TREND_FOLLOWING', 'MA_CROSSOVER', 'MEAN_REVERSION', 'RSI'];

// ── Synthetic market: trending regimes + noise + a drawdown phase ─────────────
function makeSeries(n, seed, { trendStrength = 0.35, noise = 1.6 } = {}) {
  const bars = []; let p = 100 + seed * 7;
  const d0 = new Date('2023-01-02');
  for (let i = 0; i < n; i++) {
    // regime: long uptrend → sharp correction → recovery (typical equity shape)
    const phase = i / n;
    const trend = phase < 0.45 ?  trendStrength
                : phase < 0.62 ? -trendStrength * 2.2
                :                 trendStrength * 0.9;
    const wave  = Math.sin((i + seed * 3) / 11) * noise;
    p = Math.max(5, p + trend + wave);
    const c = +p.toFixed(2);
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    bars.push({ date: d.toISOString().slice(0, 10), open: c,
      high: +(c * 1.008).toFixed(2), low: +(c * 0.992).toFixed(2), close: c, volume: 1000 });
  }
  return bars;
}

async function realSeries(symbols) {
  const md = require('../src/services/marketDataService');
  const series = {};
  for (const s of symbols) {
    try {
      const cd = await md.getCandles(s, { interval: 'day', days: 900 });
      const c = (cd?.candles || []).map(k => ({ date: String(k.t).slice(0, 10), open: k.o, high: k.h, low: k.l, close: k.c }));
      if (c.length >= 250) series[s] = c;
      else console.log(`  (skipped ${s}: only ${c.length} bars)`);
    } catch (e) { console.log(`  (skipped ${s}: ${e.message})`); }
  }
  return series;
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

(async () => {
  const args = process.argv.slice(2);
  const realIdx = args.indexOf('--real');
  let series, label;

  if (realIdx !== -1) {
    const syms = args.slice(realIdx + 1);
    if (!syms.length) { console.error('Usage: --real SYM1 SYM2 ...'); process.exit(1); }
    console.log(`\nFetching real daily candles for: ${syms.join(', ')}`);
    series = await realSeries(syms);
    label = `REAL data — ${Object.keys(series).join(', ')}`;
    if (!Object.keys(series).length) { console.error('No usable data (broker session required).'); process.exit(1); }
  } else {
    series = { AAA: makeSeries(600, 1), BBB: makeSeries(600, 4), CCC: makeSeries(600, 9) };
    label = 'SYNTHETIC data (uptrend → correction → recovery)';
  }

  // Two exit regimes. The point is to separate "which ENTRY signal is good"
  // from "are my EXIT rules mathematically viable at all".
  const PROFILES = {
    'A · current rules (SL 2% / TP 4%)': {
      stopPct: 0.02, takeProfitPct: 0.04, exitOnSignal: false,
    },
    'B · trend rules (SL 8%, no TP, signal exit)': {
      stopPct: 0.08, takeProfitPct: 0, exitOnSignal: true,
    },
  };

  console.log(`\n══ Strategy comparison — ${label} ══`);
  console.log('   shared capital ₹10,00,000 · max 3 positions · 5bps slippage · risk-based sizing');

  const all = {};
  for (const [profName, prof] of Object.entries(PROFILES)) {
    console.log(`\n── PROFILE ${profName} ──`);
    console.log(pad('STRATEGY', 17) + pad('RETURN%', 10) + pad('SHARPE', 9) + pad('MAXDD%', 9) + pad('TRADES', 8) + pad('WIN%', 7) + 'AVG WIN/LOSS');
    console.log('─'.repeat(74));
    const rows = [];
    for (const strategy of STRATEGIES) {
      try {
        const { summary, trades } = runPortfolioBacktest({
          series,
          config: {
            initialCapital: 1_000_000, strategy, minConfidence: 0.3,
            maxConcurrent: 3, sizingMethod: 'risk', riskPerTrade: 0.01,
            slippagePct: 0.0005, warmup: 210, ...prof,
          },
        });
        const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
        const avgW = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
        const avgL = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0;
        rows.push({ strategy, ...summary });
        console.log(
          pad(strategy, 17) + pad(num(summary.totalReturnPct), 10) +
          pad(num(summary.sharpeRatio, 3), 9) + pad(num(summary.maxDrawdownPct), 9) +
          pad(summary.totalTrades, 8) + pad(num(summary.winRatePct, 1), 7) +
          `₹${Math.round(avgW)} / ₹${Math.round(avgL)}`
        );
      } catch (e) { console.log(pad(strategy, 17) + `error: ${e.message}`); }
    }
    all[profName] = rows;
    const ranked = rows.filter(r => Number.isFinite(r.totalReturnPct)).sort((a, b) => b.totalReturnPct - a.totalReturnPct);
    if (ranked.length) console.log('best: ' + ranked.slice(0, 2).map(r => `${r.strategy} ${num(r.totalReturnPct)}%`).join('  >  '));
  }

  console.log('\n── Expectancy check (why exits matter more than entries) ──');
  console.log('   With SL 2% / TP 4%, breakeven needs a >33% win rate.');
  console.log('   EV per trade = win% × avgWin − loss% × avgLoss. If that is negative,');
  console.log('   NO entry signal can rescue it — the exit rules are the problem.');
  console.log('\n⚠  Past performance — on synthetic OR historical data — does not predict');
  console.log('   future results. Validate on out-of-sample data before risking money.\n');
})().catch(e => { console.error(e.stack); process.exit(1); });
