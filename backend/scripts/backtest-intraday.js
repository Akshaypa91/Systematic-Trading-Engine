// scripts/backtest-intraday.js
// ─────────────────────────────────────────────────────────────────────────────
// Bar-by-bar backtest of the 1-minute VWAP scalper, with costs shown as a
// separate line rather than hidden inside the return.
//
// Why a dedicated runner: portfolioBacktester is daily-oriented (one decision
// per bar per symbol, positions can span days). Intraday needs a session loop,
// a forced square-off before the close, and — most importantly — HONEST cost
// accounting, because scalping lives or dies on it. The output therefore reports
//     gross return → cost drag → NET return
// plus intraday buy & hold (first bar → last bar) as the benchmark.
//
//   node scripts/backtest-intraday.js                       # synthetic sessions
//   node scripts/backtest-intraday.js --real RELIANCE TCS   # needs broker
//   node scripts/backtest-intraday.js --real ... --costbps 12
//
// A negative net with a positive gross is the expected, informative outcome:
// it means the signal works but the frictions eat it.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
require('dotenv').config();

const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {}; logger.warn = () => {};

const scalper = require('../src/strategies/intradayScalper');

const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const pad = (s, n) => String(s).padEnd(n);

// ── Synthetic intraday sessions: mean-reverting around a level, with noise ────
function makeSession(dayIdx, bars = 375, base = 1000) {
  const out = [];
  let p = base;
  for (let i = 0; i < bars; i++) {
    // Ornstein–Uhlenbeck-ish pull to base + noise → genuine mean reversion,
    // i.e. the friendliest possible world for this strategy.
    const pull = (base - p) * 0.02;
    const noise = Math.sin((i + dayIdx * 7) / 9) * 1.1 + Math.cos(i / 3.3) * 0.6;
    p = Math.max(1, p + pull + noise);
    const mins = 9 * 60 + 15 + i;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const c = +p.toFixed(2);
    out.push({
      date: `2025-01-${String((dayIdx % 28) + 1).padStart(2, '0')}T${hh}:${mm}:00+05:30`,
      open: c, high: +(c + 0.9).toFixed(2), low: +(c - 0.9).toFixed(2), close: c, volume: 1000 + (i % 50) * 20,
    });
  }
  return out;
}

async function realSessions(symbols) {
  const md = require('../src/services/marketDataService');
  const out = {};
  for (const s of symbols) {
    try {
      const cd = await md.getCandles(s, { interval: '1minute', days: 30 });
      const bars = (cd?.candles || []).map(k => ({
        date: String(k.t), open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v,
      })).filter(b => Number.isFinite(b.close));
      if (bars.length >= 200) out[s] = bars;
      else console.log(`  (skipped ${s}: ${bars.length} 1-min bars, need 200+)`);
    } catch (e) { console.log(`  (skipped ${s}: ${e.message})`); }
  }
  return out;
}

// Session grouping, the run loop and the buy & hold benchmark live in
// src/engine/intradayBacktester.js so this CLI and POST /api/backtest/intraday
// execute the SAME code — the strategyCore lesson: one path, no drift.
const engine = require('../src/engine/intradayBacktester');
const { runSymbol, buyHoldIntraday } = engine;

(async () => {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--costbps');
  const costBps = ci !== -1 ? parseFloat(args[ci + 1]) : 18;
  const ri = args.indexOf('--real');

  let data, label;
  if (ri !== -1) {
    const syms = args.slice(ri + 1).filter(a => !a.startsWith('--') && isNaN(parseFloat(a)));
    console.log(`\nFetching 1-minute candles: ${syms.join(', ')}`);
    data = await realSessions(syms);
    label = 'REAL 1-minute data';
    if (!Object.keys(data).length) { console.error('No usable 1-min data (broker session required).'); process.exit(1); }
  } else {
    data = { SYNTH_A: [], SYNTH_B: [] };
    for (let d = 0; d < 10; d++) { data.SYNTH_A.push(...makeSession(d, 375, 1000)); data.SYNTH_B.push(...makeSession(d + 3, 375, 2500)); }
    label = 'SYNTHETIC mean-reverting sessions (best case for this strategy)';
  }

  console.log(`\n══ 1-MINUTE SCALPER BACKTEST — ${label} ══`);
  console.log(`   round-trip cost assumption: ${costBps} bps · cost gate: ${scalper.PARAMS.MIN_EDGE_MULT}× costs\n`);
  console.log(pad('SYMBOL', 12) + pad('TRADES', 8) + pad('WIN%', 7) + pad('GROSS ₹', 12) + pad('COSTS ₹', 12) + pad('NET ₹', 12) + 'AVG HELD');
  console.log('─'.repeat(75));

  // One call into the shared engine — identical to what the HTTP endpoint runs.
  const result = engine.run(data, { costBps });
  for (const r of result.perSymbol) {
    console.log(pad(r.symbol, 12) + pad(r.trades, 8) + pad(r.trades ? num(r.winRatePct, 1) : '—', 7) +
      pad(num(r.gross), 12) + pad(num(r.cost), 12) + pad(num(r.net), 12) + `${num(r.avgHeldBars, 0)} bars`);
  }
  const T = result.totals;
  console.log('─'.repeat(75));
  console.log(pad('TOTAL', 12) + pad(T.trades, 8) + pad(T.trades ? num(T.winRatePct, 1) : '', 7) +
    pad(num(T.gross), 12) + pad(num(T.cost), 12) + pad(num(T.net), 12));

  console.log('\n── Cost reality ──');
  console.log(`   ${result.verdict}`);
  if (T.trades > 0) {
    console.log(`   Gross ₹${num(T.gross)} → costs ₹${num(T.cost)}${T.costDragPct != null ? ` (${num(T.costDragPct, 1)}% of gross)` : ''} → NET ₹${num(T.net)}`);
    if (T.net > 0) console.log(`   After 20% STCG ≈ ₹${num(T.netAfterTax)}.`);
  }

  console.log('\n── Benchmark: intraday buy & hold (open→close each session) ──');
  for (const r of result.perSymbol) {
    console.log(`   ${pad(r.symbol, 12)} ${r.sessions} sessions · net ₹${num(r.buyHoldNet)}`);
  }

  console.log('\n⚠  Synthetic data is deliberately mean-reverting, so it FLATTERS this');
  console.log('   strategy. Only --real results on your own data mean anything, and even');
  console.log('   those need walk-forward validation before risking money.\n');
})().catch(e => { console.error(e.stack); process.exit(1); });
