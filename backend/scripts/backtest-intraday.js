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

/** Split a flat bar array into per-session groups by calendar date. */
function bySession(bars) {
  const map = new Map();
  for (const b of bars) {
    const day = String(b.date).slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(b);
  }
  return [...map.values()];
}

/**
 * Run the scalper over one symbol's bars.
 * Costs are charged per ROUND TRIP in bps of notional.
 */
function runSymbol(bars, { costBps = 18, warmup = 30, capitalPerTrade = 100000 } = {}) {
  const trades = [];
  for (const session of bySession(bars)) {
    if (session.length < warmup + 5) continue;
    let pos = null;   // { entry, qty, entryIdx }

    for (let i = warmup; i < session.length; i++) {
      const window = session.slice(0, i + 1);
      const bar = session[i];
      const price = Number(bar.close);
      if (!(price > 0)) continue;

      const sig = scalper.generateSignal(window, { roundTripBps: costBps });

      if (!pos && sig.signal === 'BUY') {
        const qty = Math.max(1, Math.floor(capitalPerTrade / price));
        pos = { entry: price, qty, entryIdx: i, stop: sig.stop, target: sig.target };
        continue;
      }

      if (pos) {
        let exit = null, reason = null;
        if (Number(bar.low) <= pos.stop)        { exit = pos.stop;   reason = 'STOP'; }
        else if (Number(bar.high) >= pos.target){ exit = pos.target; reason = 'TARGET'; }
        else if (sig.signal === 'SELL')         { exit = price;      reason = sig.reason?.includes('Square-off') ? 'SQUARE_OFF' : 'SIGNAL'; }
        else if (i === session.length - 1)      { exit = price;      reason = 'EOD'; }

        if (exit != null) {
          const notional = pos.qty * pos.entry;
          const gross = (exit - pos.entry) * pos.qty;
          const cost  = notional * (costBps / 10000);
          trades.push({
            entry: pos.entry, exit: +exit.toFixed(2), qty: pos.qty, reason,
            grossPnl: +gross.toFixed(2), cost: +cost.toFixed(2), netPnl: +(gross - cost).toFixed(2),
            heldBars: i - pos.entryIdx, notional: +notional.toFixed(2),
          });
          pos = null;
        }
      }
    }
  }
  return trades;
}

/** Intraday buy & hold: buy first bar of each session, sell last. */
function buyHoldIntraday(bars, costBps, capitalPerTrade = 100000) {
  let gross = 0, cost = 0, n = 0;
  for (const session of bySession(bars)) {
    if (session.length < 2) continue;
    const a = Number(session[0].close), b = Number(session[session.length - 1].close);
    if (!(a > 0) || !(b > 0)) continue;
    const qty = Math.max(1, Math.floor(capitalPerTrade / a));
    gross += (b - a) * qty;
    cost  += qty * a * (costBps / 10000);
    n++;
  }
  return { sessions: n, grossPnl: gross, cost, netPnl: gross - cost };
}

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

  let tG = 0, tC = 0, tN = 0, tT = 0;
  for (const [sym, bars] of Object.entries(data)) {
    const trades = runSymbol(bars, { costBps });
    const wins = trades.filter(t => t.netPnl > 0).length;
    const g = trades.reduce((a, t) => a + t.grossPnl, 0);
    const c = trades.reduce((a, t) => a + t.cost, 0);
    const n = g - c;
    const held = trades.length ? trades.reduce((a, t) => a + t.heldBars, 0) / trades.length : 0;
    tG += g; tC += c; tN += n; tT += trades.length;
    console.log(pad(sym, 12) + pad(trades.length, 8) + pad(trades.length ? num((wins / trades.length) * 100, 1) : '—', 7) +
      pad(num(g), 12) + pad(num(c), 12) + pad(num(n), 12) + `${num(held, 0)} bars`);
  }

  console.log('─'.repeat(75));
  console.log(pad('TOTAL', 12) + pad(tT, 8) + pad('', 7) + pad(num(tG), 12) + pad(num(tC), 12) + pad(num(tN), 12));

  console.log('\n── Cost reality ──');
  if (tT === 0) {
    console.log('   No trades taken. The cost gate rejected every setup — the signal never');
    console.log(`   found a move worth ≥ ${(costBps * scalper.PARAMS.MIN_EDGE_MULT).toFixed(0)} bps. That is a valid result.`);
  } else {
    const drag = tG !== 0 ? (tC / Math.abs(tG)) * 100 : 0;
    console.log(`   Gross ₹${num(tG)} → costs ₹${num(tC)} (${num(drag, 1)}% of gross) → NET ₹${num(tN)}`);
    console.log(tN > 0
      ? '   Net POSITIVE before tax. Note: 20% STCG applies to intraday gains in India,'
      : '   Net NEGATIVE — the signal may work but frictions consume it. This is the');
    console.log(tN > 0
      ? `   which would leave ≈ ₹${num(tN * 0.8)}.`
      : '   normal outcome for retail scalping and why turnover is the enemy.');
  }

  console.log('\n── Benchmark: intraday buy & hold (open→close each session) ──');
  for (const [sym, bars] of Object.entries(data)) {
    const bh = buyHoldIntraday(bars, costBps);
    console.log(`   ${pad(sym, 12)} ${bh.sessions} sessions · net ₹${num(bh.netPnl)}`);
  }

  console.log('\n⚠  Synthetic data is deliberately mean-reverting, so it FLATTERS this');
  console.log('   strategy. Only --real results on your own data mean anything, and even');
  console.log('   those need walk-forward validation before risking money.\n');
})().catch(e => { console.error(e.stack); process.exit(1); });
