// scripts/test-cross-exchange-spread.js — pure spread + cost math. Offline.
//   node scripts/test-cross-exchange-spread.js
'use strict';
const logger = require('../src/config/logger');
logger.debug = () => {};
const { analyseSpread, toBseKey } = require('../src/services/crossExchangeSpread');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('toBseKey');
ok('derives BSE key from NSE key (same ISIN)', toBseKey('NSE_EQ|INE002A01018') === 'BSE_EQ|INE002A01018');
ok('null for junk', toBseKey('garbage') === null && toBseKey(null) === null);

console.log('analyseSpread');
let r = analyseSpread(1292.90, 1293.40, 100);   // ~4 bps gap on RELIANCE
ok('computes spread in ₹ and bps', r && Math.abs(r.spreadAbs - 0.5) < 1e-6 && r.spreadBps > 3 && r.spreadBps < 5, JSON.stringify(r));
ok('identifies the cheaper exchange', r.cheaper === 'NSE');
ok('a ~4bps gap is NOT capturable after costs', r.capturable === false, `netBps=${r.netBps}`);
ok('verdict explains why', /NOT capturable/.test(r.verdict));

// A deliberately huge (unrealistic) gap SHOULD clear costs — proves the maths
// isn't just hard-coded to "no".
r = analyseSpread(1000, 1050, 100);             // 500 bps
ok('a 5% gap does clear costs', r.capturable === true, `netBps=${r.netBps}`);
ok('but the verdict still warns about latency', /close before/.test(r.verdict));

console.log('guards');
ok('zero price → null', analyseSpread(0, 100, 10) === null);
ok('negative → null', analyseSpread(-5, 100, 10) === null);
ok('identical prices → 0 bps, not capturable', (() => { const x = analyseSpread(500, 500, 10); return x.spreadBps === 0 && !x.capturable; })());

console.log('cost scales sensibly');
const small = analyseSpread(1000, 1002, 1);
const big   = analyseSpread(1000, 1002, 1000);
ok('per-share cost falls with size (flat brokerage amortised)', big.costBps <= small.costBps, `${big.costBps} vs ${small.costBps}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
