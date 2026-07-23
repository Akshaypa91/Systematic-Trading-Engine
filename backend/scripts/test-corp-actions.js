// scripts/test-corp-actions.js
// Offline unit test for the corporate-actions adjustment engine. No DB needed —
// we stub db.query to force the in-memory SEED fallback (RELIANCE 1:1 bonus).
//   run:  node scripts/test-corp-actions.js
'use strict';

// Force the DB read to fail fast so getActions() uses the SEED map.
const db = require('../src/config/database');
db.query = async () => { throw new Error('stubbed: no db in test'); };
// Quiet the logger.
const logger = require('../src/config/logger');
logger.debug = () => {}; logger.info = () => {};

const corp = require('../src/data/corporateActions');

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

(async () => {
  console.log('corporateActions.adjustCandles');

  // RELIANCE 1:1 bonus, ex-date 2024-10-28, factor 0.5.
  // Pre-ex candles must be halved; on/after ex-date unchanged.
  const reliance = [
    { t: '2024-10-25', o: 2600, h: 2620, l: 2580, c: 2606, v: 1000 }, // pre-ex
    { t: '2024-10-28', o: 1305, h: 1315, l: 1295, c: 1310, v: 2000 }, // ex-date (unchanged)
    { t: '2024-10-29', o: 1312, h: 1330, l: 1300, c: 1327, v: 1800 }, // post-ex
  ];
  const r = await corp.adjustCandles('RELIANCE', reliance);
  ok('reports adjusted=true', r.adjusted === true);
  ok('pre-ex close halved 2606 -> 1303', approx(r.candles[0].c, 1303), `got ${r.candles[0].c}`);
  ok('pre-ex open halved 2600 -> 1300', approx(r.candles[0].o, 1300), `got ${r.candles[0].o}`);
  ok('pre-ex volume doubled 1000 -> 2000', r.candles[0].v === 2000, `got ${r.candles[0].v}`);
  ok('ex-date candle unchanged (1310)', approx(r.candles[1].c, 1310), `got ${r.candles[1].c}`);
  ok('post-ex candle unchanged (1327)', approx(r.candles[2].c, 1327), `got ${r.candles[2].c}`);

  // Continuity: adjusted pre-ex close (~1303) should sit right next to the
  // ex-date close (1310) — no ~50% cliff anymore.
  const gap = Math.abs(r.candles[0].c - r.candles[1].c) / r.candles[1].c;
  ok('no discontinuity across ex-date (<5%)', gap < 0.05, `gap=${(gap * 100).toFixed(1)}%`);

  // Symbol with no actions: pass through untouched (same object array).
  const acme = [{ t: '2024-01-01', o: 100, h: 101, l: 99, c: 100, v: 10 }];
  const r2 = await corp.adjustCandles('ACMEUNKNOWN', acme);
  ok('unknown symbol not adjusted', r2.adjusted === false && r2.candles === acme);

  // dataStore shape {date,open,high,low,close,volume} is also handled.
  const dsShape = [
    { date: '2024-10-25', open: 2600, high: 2620, low: 2580, close: 2606, volume: 1000 },
    { date: '2024-10-29', open: 1312, high: 1330, low: 1300, close: 1327, volume: 1800 },
  ];
  const r3 = await corp.adjustCandles('RELIANCE', dsShape);
  ok('dataStore shape pre-ex close halved', approx(r3.candles[0].close, 1303), `got ${r3.candles[0].close}`);
  ok('dataStore shape post-ex unchanged', approx(r3.candles[1].close, 1327), `got ${r3.candles[1].close}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
