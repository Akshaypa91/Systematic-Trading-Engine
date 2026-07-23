// scripts/test-position-sizing.js — pure sizing math. Offline.
//   node scripts/test-position-sizing.js
'use strict';
const { computeQty } = require('../src/risk/positionSizing');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('fixed');
ok('fixed qty 3', computeQty({ method: 'fixed', price: 100, fixedQty: 3, capital: 1e6 }) === 3);
ok('price 0 → 0', computeQty({ method: 'fixed', price: 0, fixedQty: 3 }) === 0);

console.log('risk-based');
// capital 1,000,000 · risk 1% = ₹10,000 risk; stop 2% of ₹100 = ₹2/share → 5,000 shares,
// but affordability caps at floor(950000/100)=9500, and no maxPositionValue → 5000.
ok('risk sizing = 5000 shares', computeQty({ method: 'risk', price: 100, capital: 1e6, riskPerTrade: 0.01, stopPct: 0.02 }) === 5000,
  String(computeQty({ method: 'risk', price: 100, capital: 1e6, riskPerTrade: 0.01, stopPct: 0.02 })));
// Tighter capital: affordability binds. capital 10,000 → risk ₹100 → 50 shares; afford floor(9500/100)=95 → 50.
ok('affordability not binding here (50)', computeQty({ method: 'risk', price: 100, capital: 10000, riskPerTrade: 0.01, stopPct: 0.02 }) === 50);

console.log('vol-target');
// capital 1,000,000; targetVol 2%, assetVol 4% → exposure 500,000 → /100 = 5000 shares (afford 9500) → 5000.
ok('voltarget 5000 shares', computeQty({ method: 'voltarget', price: 100, capital: 1e6, targetVol: 0.02, assetVol: 0.04 }) === 5000,
  String(computeQty({ method: 'voltarget', price: 100, capital: 1e6, targetVol: 0.02, assetVol: 0.04 })));
// Higher assetVol → smaller position. assetVol 8% → exposure 250,000 → 2500.
ok('higher vol → smaller (2500)', computeQty({ method: 'voltarget', price: 100, capital: 1e6, targetVol: 0.02, assetVol: 0.08 }) === 2500);
ok('missing assetVol → 0', computeQty({ method: 'voltarget', price: 100, capital: 1e6, targetVol: 0.02 }) === 0);

console.log('caps');
// maxPositionValue ₹50,000 at ₹100 → cap 500 shares even though risk sizing wants 5000.
ok('maxPositionValue caps to 500', computeQty({ method: 'risk', price: 100, capital: 1e6, riskPerTrade: 0.01, stopPct: 0.02, maxPositionValue: 50000 }) === 500);
// Affordability: capital ₹5,000 at ₹100 → floor(4750/100)=47.
ok('affordability caps to 47', computeQty({ method: 'fixed', price: 100, fixedQty: 1000, capital: 5000 }) === 47);
ok('never negative', computeQty({ method: 'risk', price: 100, capital: -5, riskPerTrade: 0.01, stopPct: 0.02 }) >= 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
