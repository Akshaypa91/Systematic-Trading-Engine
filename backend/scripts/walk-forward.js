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
    let syms = args.slice(ri + 1).filter(a => !a.startsWith('--') && isNaN(parseFloat(a)));
    // --real --universe → run the whole NIFTY-50 list. Five correlated large
    // caps give far too few independent observations to detect a small edge;
    // widening the cross-section is the cheapest way to get real statistics.
    if (args.includes('--universe') || syms[0] === 'UNIVERSE') {
      syms = (require('../src/config/constants').NIFTY50_SYMBOLS || []).slice(0, 50);
      console.log(`\nUniverse mode: ${syms.length} symbols (this takes a few minutes)`);
    }
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

  // ── Rolling (anchored) walk-forward: repeat the train→test exercise across
  // several successive windows. One 70/30 split can be a lucky window; a
  // strategy that wins in MOST folds is far better evidence than one that wins
  // in a single arbitrary split.
  const fi = args.indexOf('--folds');
  const folds = fi !== -1 ? Math.max(2, parseInt(args[fi + 1], 10) || 3) : 0;
  if (folds) {
    const symsAll = Object.keys(series);
    const len = Math.min(...symsAll.map(s => series[s].length));
    const testLen = Math.floor(len * (1 - ratio) / folds);
    if (testLen < 100) { console.error(`\nNot enough history for ${folds} folds (need ~${100 * folds} test bars).`); process.exit(1); }
    console.log(`\n══ ROLLING WALK-FORWARD (${label}) — ${symsAll.join(', ')} ══`);
    console.log(`   ${folds} folds · each: train on everything before the window, test on the next ≈${testLen} bars\n`);

    const tally = {};   // strategy → { wins, oosSum, picked }
    for (const s of STRATEGIES) tally[s] = { oosSum: 0, wins: 0, picked: 0, pickedOosSum: 0 };

    for (let f = 0; f < folds; f++) {
      const trainEnd = Math.floor(len * ratio) + f * testLen;
      const testEnd  = Math.min(trainEnd + testLen, len);
      if (testEnd - trainEnd < 60) break;
      const TR = {}, TE = {};
      for (const s of symsAll) {
        TR[s] = series[s].slice(0, trainEnd);
        TE[s] = series[s].slice(Math.max(0, trainEnd - 210), testEnd);
      }
      const trRes = runAll(TR), teRes = runAll(TE);
      // THE benchmark. Any strategy must beat simply holding the same basket —
      // otherwise all the signals, costs and risk are destroying value versus
      // doing nothing. Equal-weight, buy at the first testable bar, hold.
      const bhRet = (() => {
        const rs = [];
        for (const s of Object.keys(TE)) {
          const bars = TE[s].slice(210);            // skip warmup region
          if (bars.length < 2) continue;
          const a = Number(bars[0].close), b = Number(bars[bars.length - 1].close);
          if (a > 0 && b > 0) rs.push(((b - a) / a) * 100);
        }
        return rs.length ? rs.reduce((x, y) => x + y, 0) / rs.length : NaN;
      })();
      teRes.__BUY_HOLD__ = { totalReturnPct: bhRet, sharpeRatio: NaN, maxDrawdownPct: NaN, totalTrades: 0, winRatePct: NaN };
      const trValid = Object.entries(trRes).filter(([, r]) => Number.isFinite(r.totalReturnPct));
      if (!trValid.length) continue;
      const pick = trValid.sort((a, b) => b[1].totalReturnPct - a[1].totalReturnPct)[0][0];
      const oosRank = Object.entries(teRes).filter(([, r]) => Number.isFinite(r.totalReturnPct))
        .sort((a, b) => b[1].totalReturnPct - a[1].totalReturnPct);
      const pickOos = teRes[pick]?.totalReturnPct;
      const bh = teRes.__BUY_HOLD__.totalReturnPct;
      const verdict = Number.isFinite(pickOos) && Number.isFinite(bh)
        ? (pickOos > bh ? 'BEAT buy&hold' : 'LOST to buy&hold') : '';
      console.log(`  Fold ${f + 1}: pick=${pad(pick, 16)} OOS ${pad(num(pickOos) + '%', 9)} buy&hold ${pad(num(bh) + '%', 9)} ${verdict}`);
      for (const [s, r] of Object.entries(teRes)) {
        if (!Number.isFinite(r.totalReturnPct)) continue;
        if (!tally[s]) tally[s] = { oosSum: 0, wins: 0, picked: 0, pickedOosSum: 0 };
        tally[s].oosSum += r.totalReturnPct;
        if (r.totalReturnPct > 0) tally[s].wins++;
      }
      tally[pick].picked++;
      if (Number.isFinite(pickOos)) tally[pick].pickedOosSum += pickOos;
    }

    console.log(`\n── Across all folds (out-of-sample only) ──`);
    console.log(pad('STRATEGY', 17) + pad('AVG OOS%', 11) + pad('POSITIVE FOLDS', 16) + 'TIMES PICKED');
    console.log('─'.repeat(60));
    const ranked = Object.entries(tally).sort((a, b) => b[1].oosSum - a[1].oosSum);
    for (const [s, t] of ranked) {
      const nm = s === '__BUY_HOLD__' ? '» BUY & HOLD' : s;
      console.log(pad(nm, 17) + pad(num(t.oosSum / folds), 11) + pad(`${t.wins}/${folds}`, 16) + (s === '__BUY_HOLD__' ? '—' : t.picked));
    }
    const bhAvg = tally.__BUY_HOLD__ ? tally.__BUY_HOLD__.oosSum / folds : NaN;
    if (Number.isFinite(bhAvg)) {
      const beaters = ranked.filter(([s, t]) => s !== '__BUY_HOLD__' && t.oosSum / folds > bhAvg).map(([s]) => s);
      console.log(`\n   Buy & hold averaged ${num(bhAvg)}% per fold.`);
      console.log(beaters.length
        ? `   Beat it out-of-sample: ${beaters.join(', ')}`
        : `   NOTHING beat buy & hold out-of-sample. All the signals, trades and`);
      if (!beaters.length) console.log(`   costs destroyed value versus simply holding the basket.`);
    }
    console.log(`\n   Consistency across folds matters more than any single number.`);
    console.log(`   A strategy positive in ${folds}/${folds} folds is meaningfully better evidence`);
    console.log(`   than one that won a single split.\n`);
    process.exit(0);
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
