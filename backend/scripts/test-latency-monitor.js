// scripts/test-latency-monitor.js — latency stats + reaction budget. Offline.
//   node scripts/test-latency-monitor.js
'use strict';
const lat = require('../src/utils/latencyMonitor');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

lat.reset();

console.log('record + percentiles');
for (let i = 1; i <= 100; i++) lat.record('feed_age', i);      // 1..100 ms
let s = lat.statsFor('feed_age');
ok('100 samples', s.samples === 100, String(s.samples));
ok('p50 ≈ 50', Math.abs(s.p50 - 50) <= 1, String(s.p50));
ok('p95 ≈ 95', Math.abs(s.p95 - 95) <= 1, String(s.p95));
ok('p99 ≈ 99', Math.abs(s.p99 - 99) <= 1, String(s.p99));
ok('max 100', s.max === 100, String(s.max));
ok('avg ≈ 50.5', Math.abs(s.avg - 50.5) < 0.1, String(s.avg));

console.log('guards');
lat.record('feed_age', -5); lat.record('feed_age', NaN); lat.record('feed_age', 'abc');
ok('rejects invalid samples', lat.statsFor('feed_age').samples === 100);
ok('unknown stage → null', lat.statsFor('nope') === null);

console.log('reaction budget');
lat.reset();
lat.record('feed_age', 1500);      // REST poller staleness
lat.record('signal_calc', 4);
lat.record('order_place', 260);
const r = lat.report();
ok('sums the three stages', r.reaction.totalMs === 1764, String(r.reaction.totalMs));
ok('reports microseconds too', r.reaction.totalMicroseconds === 1764000, String(r.reaction.totalMicroseconds));
ok('classifies seconds-scale honestly', /seconds-scale/.test(r.reaction.classification), r.reaction.classification);
ok('note quantifies the HFT gap', /faster than this system/.test(r.reaction.note), r.reaction.note);

console.log('classification bands');
const cls = (ms) => { lat.reset(); lat.record('order_place', ms); return lat.report().reaction.classification; };
ok('0.5ms → HFT territory (implausible)', /implausible/.test(cls(0.5)));
ok('30ms → very fast for retail', /very fast/.test(cls(30)));
ok('150ms → typical fast retail', /typical fast retail/.test(cls(150)));
ok('600ms → slow, not competitive', /not competitive/.test(cls(600)));

console.log('timing helpers');
lat.reset();
lat.timeSync('signal_calc', () => { let x = 0; for (let i = 0; i < 1e5; i++) x += i; return x; });
ok('timeSync records a sample', lat.statsFor('signal_calc')?.samples === 1);

(async () => {
  await lat.time('order_place', async () => new Promise(r => setTimeout(r, 20)));
  const st = lat.statsFor('order_place');
  ok('async time() records ≥ ~20ms', st && st.last >= 15, String(st?.last));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
