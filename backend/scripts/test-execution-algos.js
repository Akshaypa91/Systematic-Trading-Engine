// scripts/test-execution-algos.js — pure execution algos + sliced executor. Offline.
//   node scripts/test-execution-algos.js
'use strict';
const A = require('../src/engine/executionAlgos');

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('sliceOrder');
ok('qty ≤ max → single slice', eq(A.sliceOrder(50, 100), [50]));
ok('max ≤ 0 → single slice', eq(A.sliceOrder(50, 0), [50]));
ok('250/100 → [84,83,83] (even, sums to 250)', (() => { const s = A.sliceOrder(250, 100); return s.every(x => x <= 100) && s.reduce((a, b) => a + b, 0) === 250 && s.length === 3; })(), JSON.stringify(A.sliceOrder(250, 100)));
ok('200/100 → [100,100]', eq(A.sliceOrder(200, 100), [100, 100]));
ok('0 → []', eq(A.sliceOrder(0, 100), []));

console.log('twapSchedule');
let t = A.twapSchedule(100, 4, 5000);
ok('4 slices summing to 100', t.length === 4 && t.reduce((a, s) => a + s.qty, 0) === 100, JSON.stringify(t));
ok('offsets 0,5k,10k,15k', eq(t.map(s => s.offsetMs), [0, 5000, 10000, 15000]));
t = A.twapSchedule(10, 3, 1000);
ok('10 into 3 → [4,3,3] sum 10', t.reduce((a, s) => a + s.qty, 0) === 10 && t.length === 3, JSON.stringify(t));

console.log('limitThenMarketAction');
ok('fully filled → DONE', A.limitThenMarketAction({ elapsedMs: 1000, timeoutMs: 5000, filledQty: 10, totalQty: 10 }) === 'DONE');
ok('timeout → CONVERT_TO_MARKET', A.limitThenMarketAction({ elapsedMs: 6000, timeoutMs: 5000, filledQty: 2, totalQty: 10 }) === 'CONVERT_TO_MARKET');
ok('still time → WAIT', A.limitThenMarketAction({ elapsedMs: 1000, timeoutMs: 5000, filledQty: 2, totalQty: 10 }) === 'WAIT');

(async () => {
  console.log('executeSliced');
  const placed = [];
  const noSleep = async () => {};
  let r = await A.executeSliced(async (o) => placed.push(o.qty), { symbol: 'X', side: 'BUY', qty: 250 }, { maxChildQty: 100, intervalMs: 1000, sleep: noSleep });
  ok('placed 3 children summing to 250', r.children === 3 && placed.reduce((a, b) => a + b, 0) === 250, JSON.stringify(placed));
  ok('all placed, no errors', r.placed === 3 && r.errors === 0);

  // Errors are counted, not thrown.
  let calls = 0;
  r = await A.executeSliced(async () => { calls++; if (calls === 2) throw new Error('reject'); }, { symbol: 'X', side: 'BUY', qty: 300 }, { maxChildQty: 100, sleep: noSleep });
  ok('one child rejected counted', r.children === 3 && r.placed === 2 && r.errors === 1, JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
