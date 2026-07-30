// scripts/test-datastore-adjust.js
// dataStore must return corporate-action-ADJUSTED history to every consumer, and
// exactly once. Offline (db + corporateActions stubbed).
//   node scripts/test-datastore-adjust.js
//
// Guards two real bugs:
//  1. Stored DB bars were unadjusted while getCandles was adjusted, so indicator
//     windows straddling RELIANCE's 1:1 bonus produced nonsense (price ₹1,292
//     with SMA50 ₹2,316, Bollinger ₹395–₹3,063).
//  2. After centralising the fix, a leftover per-caller adjustment would
//     DOUBLE-adjust (₹2,606 → ₹1,303 → ₹651).
'use strict';

const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {}; logger.warn = () => {};

// Two pre-bonus bars (₹2,600-ish) and one post-bonus bar (₹1,290-ish).
const ROWS = [
  { symbol: 'RELIANCE', date: new Date('2024-10-20'), open: 2600, high: 2620, low: 2580, close: 2606.93, vwap: null, volume: 1000 },
  { symbol: 'RELIANCE', date: new Date('2024-10-25'), open: 2610, high: 2630, low: 2590, close: 2612.00, vwap: null, volume: 1100 },
  { symbol: 'RELIANCE', date: new Date('2024-11-05'), open: 1290, high: 1300, low: 1280, close: 1292.90, vwap: null, volume: 2000 },
];

const db = require('../src/config/database');
db.query = async (sql) => {
  const s = String(sql);
  if (s.includes('trade_date DESC')) return [[...ROWS].reverse()];   // getRecentPrices
  return [ROWS];                                                     // getDailyPrices / getClosePrices
};

// Stub corporateActions with RELIANCE's 1:1 bonus (factor 0.5), counting calls so
// we can prove the adjustment runs exactly once per read.
let adjustCalls = 0;
const caPath = require.resolve('../src/data/corporateActions');
require.cache[caPath] = {
  id: caPath, filename: caPath, loaded: true,
  exports: {
    getActions: async () => [{ ex_date: '2024-10-28', action_type: 'BONUS', factor: 0.5 }],
    adjustCandles: async (symbol, candles) => {
      adjustCalls++;
      const out = candles.map(c => {
        const d = String(c.date || c.t).slice(0, 10);
        if (d > '2024-10-28') return c;
        const m = (v) => (Number.isFinite(Number(v)) ? Number(v) * 0.5 : v);
        const o = { ...c };
        if ('close' in c) { o.open = m(c.open); o.high = m(c.high); o.low = m(c.low); o.close = m(c.close); }
        return o;
      });
      return { candles: out, adjusted: true };
    },
  },
};

const dataStore = require('../src/data/dataStore');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;

(async () => {
  console.log('getRecentPrices');
  adjustCalls = 0;
  let bars = await dataStore.getRecentPrices('RELIANCE', 100);
  ok('returns an array ascending by date', Array.isArray(bars) && bars[0].date < bars[bars.length - 1].date);
  ok('pre-bonus close halved (2606.93 → 1303.47)', near(bars[0].close, 1303.465), String(bars[0].close));
  ok('post-bonus close untouched (1292.90)', near(bars[2].close, 1292.90), String(bars[2].close));
  ok('adjustment ran exactly once', adjustCalls === 1, `calls=${adjustCalls}`);

  // The whole point: no ₹2,600-vs-₹1,290 cliff inside an indicator window.
  const closes = bars.map(b => b.close);
  const maxGap = Math.max(...closes.slice(1).map((c, i) => Math.abs(c - closes[i]) / closes[i]));
  ok('no >20% discontinuity across the ex-date', maxGap < 0.20, `maxGap=${(maxGap * 100).toFixed(1)}%`);

  console.log('getDailyPrices');
  adjustCalls = 0;
  const daily = await dataStore.getDailyPrices('RELIANCE', {});
  ok('pre-bonus adjusted', near(daily[0].close, 1303.465), String(daily[0].close));
  ok('adjustment ran once', adjustCalls === 1, `calls=${adjustCalls}`);

  console.log('getClosePrices');
  adjustCalls = 0;
  const cp = await dataStore.getClosePrices('RELIANCE', 0);
  ok('shape is { date, close }', cp[0] && 'date' in cp[0] && 'close' in cp[0], JSON.stringify(cp[0]));
  ok('pre-bonus adjusted', near(cp[0].close, 1303.465), String(cp[0].close));
  ok('post-bonus untouched', near(cp[2].close, 1292.90), String(cp[2].close));
  ok('adjustment ran once', adjustCalls === 1, `calls=${adjustCalls}`);

  console.log('no double adjustment');
  // A second read must give the SAME values — not halved again (₹651).
  const again = await dataStore.getRecentPrices('RELIANCE', 100);
  ok('repeat read is stable (not re-halved)', near(again[0].close, 1303.465), String(again[0].close));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
