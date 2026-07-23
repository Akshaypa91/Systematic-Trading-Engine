// scripts/test-execution-quality.js — pure slippage math. Offline.
//   node scripts/test-execution-quality.js
'use strict';
const eq = require('../src/services/executionQuality');

let pass = 0, fail = 0;
const approx = (a, b, e = 0.01) => Math.abs(a - b) <= e;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

console.log('computeSlippage');
// BUY paying 100.5 vs expected 100 → +50 bps adverse.
let s = eq.computeSlippage({ side: 'BUY', expectedPrice: 100, fillPrice: 100.5 });
ok('BUY adverse +50 bps', s && approx(s.slippageBps, 50) && !s.favorable, JSON.stringify(s));
// BUY filling cheaper → favorable (negative bps).
s = eq.computeSlippage({ side: 'BUY', expectedPrice: 100, fillPrice: 99.8 });
ok('BUY price-improvement -20 bps favorable', s && approx(s.slippageBps, -20) && s.favorable, JSON.stringify(s));
// SELL receiving less than expected → adverse.
s = eq.computeSlippage({ side: 'SELL', expectedPrice: 200, fillPrice: 199 });
ok('SELL adverse +50 bps', s && approx(s.slippageBps, 50) && !s.favorable, JSON.stringify(s));
// SELL better price → favorable.
s = eq.computeSlippage({ side: 'SELL', expectedPrice: 200, fillPrice: 201 });
ok('SELL price-improvement -50 bps favorable', s && approx(s.slippageBps, -50) && s.favorable, JSON.stringify(s));
// Bad inputs → null.
ok('missing fill → null', eq.computeSlippage({ side: 'BUY', expectedPrice: 100, fillPrice: 0 }) === null);
ok('missing expected → null', eq.computeSlippage({ side: 'BUY', expectedPrice: 0, fillPrice: 100 }) === null);

console.log('aggregate');
const orders = [
  { symbol: 'RELIANCE', side: 'BUY',  expectedPrice: 100, fillPrice: 100.5, qty: 10 }, // +50bps, cost 5
  { symbol: 'RELIANCE', side: 'SELL', expectedPrice: 100, fillPrice: 99.9,  qty: 10 }, // +10bps, cost 1
  { symbol: 'INFY',     side: 'BUY',  expectedPrice: 100, fillPrice: 99.5,  qty: 20 }, // -50bps favorable
];
const a = eq.aggregate(orders);
ok('count 3', a.count === 3, `got ${a.count}`);
ok('avg bps = (50+10-50)/3 ≈ 3.33', approx(a.avgSlippageBps, 3.33), `got ${a.avgSlippageBps}`);
ok('worst bps 50', approx(a.worstSlippageBps, 50), `got ${a.worstSlippageBps}`);
ok('favorable rate 1/3', approx(a.favorableRate, 0.333), `got ${a.favorableRate}`);
ok('total slippage cost 5 + 1 - 10 = -4', approx(a.totalSlippageCost, -4), `got ${a.totalSlippageCost}`);
ok('per-symbol RELIANCE avg 30 bps', a.bySymbol.RELIANCE && approx(a.bySymbol.RELIANCE.avgBps, 30), JSON.stringify(a.bySymbol.RELIANCE));

console.log('estimateBacktestSlippagePct');
ok('no data → 5 bps floor', approx(eq.estimateBacktestSlippagePct({ count: 0 }) * 10000, 5), '');
ok('uses adverse avg', approx(eq.estimateBacktestSlippagePct({ count: 5, avgSlippageBps: 30 }) * 10000, 30));
ok('negative avg floored to 1 bp min', eq.estimateBacktestSlippagePct({ count: 5, avgSlippageBps: -20 }) >= 0.0001);
ok('clamps huge outlier to 100 bps', eq.estimateBacktestSlippagePct({ count: 1, avgSlippageBps: 5000 }) === 0.01);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
