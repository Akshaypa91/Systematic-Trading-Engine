// scripts/walk-forward.js
// ─────────────────────────────────────────────────────────────────────────────
// OUT-OF-SAMPLE / WALK-FORWARD VALIDATION.
//
// Why this exists: compare-strategies.js runs every strategy on ONE dataset and
// prints a ranking. Choosing the winner from that table is data mining — with
// 5 strategies × 2 exit profiles you are picking the best of 10 tries on the
// same history, and the winner is partly luck. That is the single most common
// way retail systematic traders fool themselves.
//
// This script does it properly:
//   1. Split each symbol's history: IN-SAMPLE (train) → OUT-OF-SAMPLE (test).
//   2. Rank all strategies on IN-SAMPLE only.
//   3. Take the IS winner and report what it ACTUALLY did out-of-sample.
//   4. Show every strategy's OOS result too, so you can see whether the IS
//      ranking had any predictive value at all.
//
// If the in-sample winner does not hold up out-of-sample, the "edge" was noise.
// That is a valid — and valuable — result: it stops you risking money.
//
//   node scripts/walk-forward.js                       # synthetic
//   node scripts/walk-forward.js --real RELIANCE TCS INFY HDFCBANK ITC
//   node scripts/walk-forward.js --real ... --split 0.6
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
require('dotenv').config();

const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {}; logger.warn = () => {};

const { runPortfolioBacktest } = require('../src/engine/portfolioBacktester');

const STRATEGIES = ['AGGREGATED', 'TREND_FOLLOWING', 'MA_CROSSOVER', 'MEAN_REVERSION', 'RSI'];

// Exit profile held FIXED here — we are testing entry-signal selection, not
// re-optimising exits too (that would multiply the data-mining problem).
const EXIT = { stopPct: 0.08, takeProfitPct: 0, exitOnSignal: true };

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

function splitSeries(series, ratio) {
  const IS = {}, OOS = {};
  for (const [sym, bars] of Object.entries(series)) {
    const cut = Math.floor(bars.length * ratio);
    if (cut < 260 || bars.length - cut < 120) continue;   // need warmup + testable tail
    IS[sym]  = bars.slice(0, cut);
    OOS[sym] = bars.slice(cut - 210);   // carry warmup bars so indicators are valid
  }
  return { IS, OOS };
}

function runAll(series) {
  const out = {};
  for (const strategy of STRATEGIES) {
    try {
      const { summary } = runPortfolioBacktest({
        series,
        config: { initialCapital: 1_000_000, strategy, minConfidence: 0.3, maxConcurrent: 3,
          sizingMethod: 'risk', riskPerTrade: 0.01, slippagePct: 0.0005, warmup: 210, ...EXIT },
      });
      out[strategy] = summary;
    } catch (e) { out[strategy] = { error: e.message }; }
  }
  return out;
}

function table(title, res) {
  console.log(`\n── ${title} ──`);
  console.log(pad('STRATEGY', 17) + pad('RETURN%', 10) + pad('SHARPE', 9) + pad('MAXDD%', 9) + pad('TRADES', 8) + 'WIN%');
  console.log('─'.repeat(60));
  for (const [s, r] of Object.entries(res)) {
    if (r.error) { console.log(pad(s, 17) + 'error: ' + r.error); continue; }
    console.log(pad(s, 17) + pad(num(r.totalReturnPct), 10) + pad(num(r.sharpeRatio, 3), 9) +
      pad(num(r.maxDrawdownPct), 9) + pad(r.totalTrades, 8) + num(r.winRatePct, 1));
  }
}

function makeSeries(n, seed) {
  const bars = []; let p = 100 + seed * 7;
  const d0 = new Date('2022-01-03');
  for (let i = 0; i < n; i++) {
    const phase = i / n;
    const trend = phase < 0.4 ? 0.3 : phase < 0.6 ? -0.5 : 0.15;
    p = Math.max(5, p + trend + Math.sin((i + seed * 3) / 11) * 1.7);
    const c = +p.toFixed(2);
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    bars.push({ date: d.toISOString().slice(0, 10), open: c, high: +(c * 1.008).toFixed(2), low: +(c * 0.992).toFixed(2), close: c });
  }
  return bars;
}

(async () => {
  const args = process.argv.slice(2);
  const si = args.indexOf('--split');
  const ratio = si !== -1 ? parseFloat(args[si + 1]) : 0.7;
  const ri = args.indexOf('--real');

  let series, label;
  if (ri !== -1) {
    const syms = args.slice(ri + 1).filter(a => !a.startsWith('--') && isNaN(parseFloat(a)));
    const md = require('../src/services/marketDataService');
    series = {};
    console.log(`\nFetching daily candles: ${syms.join(', ')}`);
    for (const s of syms) {
      try {
        const cd = await md.getCandles(s, { interval: 'day', days: 1200 });
        const c = (cd?.candles || []).map(k => ({ date: String(k.t).slice(0, 10), open: k.o, high: k.h, low: k.l, close: k.c }));
        if (c.length >= 400) series[s] = c; else console.log(`  (skipped ${s}: ${c.length} bars, need 400+)`);
      } catch (e) { console.log(`  (skipped ${s}: ${e.message})`); }
    }
    label = 'REAL';
  } else {
    series = { AAA: makeSeries(900, 1), BBB: makeSeries(900, 4), CCC: makeSeries(900, 9) };
    label = 'SYNTHETIC';
  }

  const { IS, OOS } = splitSeries(series, ratio);
  const syms = Object.keys(IS);
  if (!syms.length) { console.error('\nNot enough history for a walk-forward split (need ~400+ bars/symbol).'); process.exit(1); }

  const isBars = Object.values(IS)[0].length, oosBars = Object.values(OOS)[0].length - 210;
  console.log(`\n══ WALK-FORWARD (${label}) — ${syms.join(', ')} ══`);
  console.log(`   split ${Math.round(ratio * 100)}/${Math.round((1 - ratio) * 100)} · in-sample ≈${isBars} bars · out-of-sample ≈${oosBars} bars`);
  console.log(`   exit profile FIXED: SL 8%, no TP, signal exit (not re-optimised)`);

  const isRes  = runAll(IS);
  const oosRes = runAll(OOS);
  table('IN-SAMPLE (used to choose)', isRes);
  table('OUT-OF-SAMPLE (the honest test)', oosRes);

  const valid = Object.entries(isRes).filter(([, r]) => !r.error && Number.isFinite(r.totalReturnPct));
  const winner = valid.sort((a, b) => b[1].totalReturnPct - a[1].totalReturnPct)[0];
  if (winner) {
    const [name] = winner;
    const oos = oosRes[name];
    console.log(`\n── VERDICT ──`);
    console.log(`   In-sample winner : ${name} (${num(winner[1].totalReturnPct)}%)`);
    console.log(`   Its OOS result   : ${num(oos?.totalReturnPct)}%  (Sharpe ${num(oos?.sharpeRatio, 3)}, ${oos?.totalTrades ?? 0} trades)`);
    const oosRank = Object.entries(oosRes).filter(([, r]) => Number.isFinite(r.totalReturnPct))
      .sort((a, b) => b[1].totalReturnPct - a[1].totalReturnPct).map(([s]) => s);
    console.log(`   OOS ranking      : ${oosRank.join(' > ')}`);
    console.log(`   IS winner ranked #${oosRank.indexOf(name) + 1} of ${oosRank.length} out-of-sample.`);
    if (oos && oos.totalReturnPct > 0 && oosRank.indexOf(name) <= 1) {
      console.log('\n   → Selection held up. Weak evidence of a real edge; still needs more data.');
    } else {
      console.log('\n   → Selection did NOT hold up out-of-sample. The in-sample ranking was');
      console.log('     largely noise — do not trade it. This is the expected result for');
      console.log('     most naive strategy bake-offs, and finding it here is a success.');
    }
  }

  console.log('\n⚠  Even a passing walk-forward on ~40 trades is weak evidence. Real');
  console.log('   validation needs hundreds of trades across multiple market regimes.\n');
})().catch(e => { console.error(e.stack); process.exit(1); });
