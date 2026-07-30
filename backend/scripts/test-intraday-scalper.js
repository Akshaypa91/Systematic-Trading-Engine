// scripts/test-intraday-scalper.js — 1-minute scalper logic + cost gate. Offline.
//   node scripts/test-intraday-scalper.js
'use strict';
const scalp = require('../src/strategies/intradayScalper');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

// Build 1-minute bars for one session. `drift` shapes the last bars so we can
// place price above/below VWAP on demand.
// `bounce` adds a small recovery on the final bars so the fast EMA can turn UP.
// The strategy deliberately refuses to buy while the micro-trend is still
// falling (no catching falling knives), so a pure drop must NOT produce a BUY.
function bars({ n = 60, start = 1000, wobble = 2, tailDrop = 0, bounce = 0, hhmmStart = 10 * 60 } = {}) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p = start + Math.sin(i / 5) * wobble;
    if (i >= n - 12 && tailDrop) p = start - tailDrop;     // dislocation
    if (i >= n - 4  && bounce)   p = start - tailDrop + bounce * (i - (n - 5));  // recovery
    const mins = hhmmStart + i;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const c = +p.toFixed(2);
    out.push({ date: `2025-01-06T${hh}:${mm}:00+05:30`, open: c, high: +(c + 1).toFixed(2), low: +(c - 1).toFixed(2), close: c, volume: 1000 });
  }
  return out;
}

console.log('guards');
let r = scalp.generateSignal([]);
ok('empty input → HOLD with reason', r.signal === 'HOLD' && /Insufficient/.test(r.reason));
r = scalp.generateSignal(bars({ n: 10 }));
ok('too few bars → HOLD', r.signal === 'HOLD' && /Insufficient/.test(r.reason));

console.log('cost gate (the important part)');
// Tiny dislocation: a few bps below VWAP → must REFUSE to trade.
r = scalp.generateSignal(bars({ n: 60, tailDrop: 0.4 }));
ok('small move rejected as not worth costs', r.signal === 'HOLD' && r.costViable === false, `${r.signal} ${r.reason}`);
ok('reason states the bps hurdle', /Move too small|ATR from VWAP/.test(r.reason), r.reason);
ok('requiredMoveBps = costs × multiple (18 × 2 = 36)', r.requiredMoveBps === 36, String(r.requiredMoveBps));

// Same setup but pretend costs are near zero → gate should now allow it.
r = scalp.generateSignal(bars({ n: 60, tailDrop: 8 }), { roundTripBps: 0.5, minEdgeMultiple: 1 });
ok('with negligible costs a real dislocation passes the gate', r.costViable === true, JSON.stringify({ s: r.signal, t: r.targetBps, req: r.requiredMoveBps }));

console.log('signals');
// Falling knife: deep drop STILL falling → must NOT buy.
r = scalp.generateSignal(bars({ n: 60, tailDrop: 12 }), { roundTripBps: 1, minEdgeMultiple: 1 });
ok('deep drop still falling → refuses to buy (no falling knife)', r.signal === 'HOLD' && /Micro-trend/.test(r.reason), `${r.signal} — ${r.reason}`);

// Purpose-built BUY setup. The two conditions pull against each other — price
// must be well BELOW VWAP while the short EMA is already ABOVE the long one — so
// build it explicitly: heavy early volume near ₹1000 holds VWAP up, price then
// dips to ₹975 and is recovering (rising last bars) but still far from VWAP.
function buySetup() {
  const out = [];
  const push = (i, close, volume) => {
    const mins = 10 * 60 + i;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    out.push({ date: `2025-01-06T${hh}:${mm}:00+05:30`, open: close,
      high: +(close + 1).toFixed(2), low: +(close - 1).toFixed(2), close: +close.toFixed(2), volume });
  };
  for (let i = 0; i < 25; i++) push(i, 1000 + Math.sin(i / 4) * 1.5, 20000);   // heavy volume, holds VWAP ≈ 1000
  for (let i = 25; i < 40; i++) push(i, 990 - (i - 25) * 1.0, 500);            // slide down to ~975
  for (let i = 40; i < 60; i++) push(i, 975 + (i - 40) * 0.55, 500);           // steady recovery → ~985
  return out;
}
r = scalp.generateSignal(buySetup(), { roundTripBps: 1, minEdgeMultiple: 1 });
ok('below VWAP + micro-trend up → BUY', r.signal === 'BUY',
  `${r.signal} — ${r.reason} (vwap ${r.vwap}, stretch ${r.stretchAtr} ATR)`);
ok('BUY carries stop and target', r.stop > 0 && r.target > 0 && r.stop < r.target, JSON.stringify({ stop: r.stop, target: r.target }));
ok('target is VWAP', Math.abs(r.target - r.vwap) < 0.01);
ok('confidence in 0..1', r.confidence >= 0 && r.confidence <= 1, String(r.confidence));

// Price at/above VWAP → exit.
r = scalp.generateSignal(bars({ n: 60, tailDrop: -6 }), { roundTripBps: 1, minEdgeMultiple: 1 });
ok('price above VWAP → SELL (reversion done)', r.signal === 'SELL', `${r.signal} — ${r.reason}`);

console.log('square-off');
// Bars ending at 15:20 → must force flat regardless of setup.
r = scalp.generateSignal(bars({ n: 60, tailDrop: 12, hhmmStart: 14 * 60 + 25 }), { roundTripBps: 1, minEdgeMultiple: 1 });
ok('after square-off time → SELL', r.signal === 'SELL' && /Square-off/.test(r.reason), `${r.signal} — ${r.reason}`);

console.log('breakeven helper');
ok('breakevenBps defaults to configured round trip', scalp.breakevenBps() === 18, String(scalp.breakevenBps()));
ok('breakevenBps honours override', scalp.breakevenBps(25) === 25);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
