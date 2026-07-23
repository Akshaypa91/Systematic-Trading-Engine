// scripts/test-position-exit.js — pure exit-rule evaluation. Offline.
//   node scripts/test-position-exit.js
'use strict';
const { evaluateExit } = require('../src/engine/positionExit');

let pass = 0, fail = 0;
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('long (BUY) positions');
let r = evaluateExit({ side: 'BUY', stopLoss: 95, takeProfit: 110, price: 111 });
ok('take-profit hit', r.shouldExit && r.reason === 'TAKE_PROFIT', JSON.stringify(r));
r = evaluateExit({ side: 'BUY', stopLoss: 95, takeProfit: 110, price: 94 });
ok('stop-loss hit', r.shouldExit && r.reason === 'STOP_LOSS', JSON.stringify(r));
r = evaluateExit({ side: 'BUY', stopLoss: 95, takeProfit: 110, price: 100 });
ok('inside band → hold', !r.shouldExit && r.reason === null, JSON.stringify(r));

console.log('long trailing stop');
// Ref high 120, 2% trail → exit at/below 117.6. price 117 → exit.
r = evaluateExit({ side: 'BUY', trailingPct: 0.02, trailRef: 120, price: 117 });
ok('trailing stop hit below high-water', r.shouldExit && r.reason === 'TRAILING_STOP', JSON.stringify(r));
// price 119 above the trail line → hold, and ref stays 120.
r = evaluateExit({ side: 'BUY', trailingPct: 0.02, trailRef: 120, price: 119 });
ok('above trail line → hold', !r.shouldExit && approx(r.newTrailRef, 120), JSON.stringify(r));
// New high 125 raises the ref.
r = evaluateExit({ side: 'BUY', trailingPct: 0.02, trailRef: 120, price: 125 });
ok('new high raises ref to 125', !r.shouldExit && approx(r.newTrailRef, 125), JSON.stringify(r));

console.log('short (SELL) positions');
r = evaluateExit({ side: 'SELL', stopLoss: 105, takeProfit: 90, price: 89 });
ok('short take-profit (price fell)', r.shouldExit && r.reason === 'TAKE_PROFIT', JSON.stringify(r));
r = evaluateExit({ side: 'SELL', stopLoss: 105, takeProfit: 90, price: 106 });
ok('short stop-loss (price rose)', r.shouldExit && r.reason === 'STOP_LOSS', JSON.stringify(r));
// Short trailing: low-water 80, 2% trail → exit at/above 81.6.
r = evaluateExit({ side: 'SELL', trailingPct: 0.02, trailRef: 80, price: 82 });
ok('short trailing stop hit', r.shouldExit && r.reason === 'TRAILING_STOP', JSON.stringify(r));
r = evaluateExit({ side: 'SELL', trailingPct: 0.02, trailRef: 80, price: 78 });
ok('short new low lowers ref to 78', !r.shouldExit && approx(r.newTrailRef, 78), JSON.stringify(r));

console.log('guards');
r = evaluateExit({ side: 'BUY', stopLoss: 95, price: 0 });
ok('no price → no exit', !r.shouldExit);
r = evaluateExit({ side: 'BUY', price: 100 });
ok('no targets → no exit', !r.shouldExit);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
