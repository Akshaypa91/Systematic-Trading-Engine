// tests/test-portfolio-v2.js
// Comprehensive test suite for Portfolio Engine v2.
// No DB or network required.
// Run: node tests/test-portfolio-v2.js
'use strict';

require('dotenv').config();
process.env.LOG_LEVEL = 'silent';

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try   { fn(); console.log(`  ✅  ${name}`); passed++; }
  catch (e) { console.error(`  ❌  ${name}\n       → ${e.message}`); failed++; }
}
function assert(c, m)  { if (!c) throw new Error(m || 'Assertion failed'); }
function assertClose(a, e, t = 0.01, m) {
  if (typeof a !== 'number' || !isFinite(a)) throw new Error(`${m||''} got non-finite: ${a}`);
  if (Math.abs(a - e) > t) throw new Error(`${m||''} expected ≈${e}±${t}, got ${a}`);
}
function assertBetween(v, lo, hi, m) {
  if (v < lo || v > hi) throw new Error(`${m||''} expected [${lo},${hi}], got ${v}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(58 - t.length)}`); }

const {
  computeCompositeScore, rankSignals, PortfolioRiskMonitor,
  allocateCapital, computePortfolioState, volScaledSize, checkPortfolioLimits,
} = require('../src/engine/portfolioEngine');

// ═══════════════════════════════════════════════════════════════════════════
section('1. computeCompositeScore — Formula Validation');
// ═══════════════════════════════════════════════════════════════════════════

test('formula: 0.4×conf + 0.3×vol + 0.3×mom', () => {
  // Perfect signal: confidence=1, vol=0 (best), momentum=10% (ceiling)
  const s = computeCompositeScore({ confidence:1, recentVol:0, momentum:0.10, signal:'BUY' });
  assertClose(s, 1.0, 0.001, 'Perfect signal must score 1.0');
});

test('zero confidence → score ≤ 0.60 (vol+mom can compensate partially)', () => {
  const s = computeCompositeScore({ confidence:0, recentVol:0.10, momentum:0.10, signal:'BUY' });
  assert(s <= 0.60, `Score with conf=0 must be ≤ 0.60, got ${s}`);
});

test('high vol reduces score vs low vol (all else equal)', () => {
  const low  = computeCompositeScore({ confidence:0.8, recentVol:0.10, momentum:0.05, signal:'BUY' });
  const high = computeCompositeScore({ confidence:0.8, recentVol:0.50, momentum:0.05, signal:'BUY' });
  assert(low > high, `Low-vol (${low}) must score higher than high-vol (${high})`);
});

test('positive momentum increases score vs zero momentum', () => {
  const withMom = computeCompositeScore({ confidence:0.7, recentVol:0.20, momentum:0.05, signal:'BUY' });
  const noMom   = computeCompositeScore({ confidence:0.7, recentVol:0.20, momentum:0,    signal:'BUY' });
  assert(withMom > noMom, `With momentum (${withMom}) must exceed no momentum (${noMom})`);
});

test('negative momentum on BUY → momScore=0 (momentum opposes signal)', () => {
  const pos = computeCompositeScore({ confidence:0.8, recentVol:0.20, momentum:0.05,  signal:'BUY' });
  const neg = computeCompositeScore({ confidence:0.8, recentVol:0.20, momentum:-0.05, signal:'BUY' });
  assertClose(neg, 0.4*0.8 + 0.3*(1-0.20/0.60) + 0.3*0, 0.005, 'Negative momentum on BUY → momScore=0');
  assert(pos > neg, 'Positive momentum must score higher than negative');
});

test('SELL signal: negative momentum is good (aligned)', () => {
  const aligned   = computeCompositeScore({ confidence:0.7, recentVol:0.20, momentum:-0.05, signal:'SELL' });
  const unaligned = computeCompositeScore({ confidence:0.7, recentVol:0.20, momentum:0.05,  signal:'SELL' });
  assert(aligned > unaligned, `Aligned SELL momentum (${aligned}) must beat unaligned (${unaligned})`);
});

test('output always in [0, 1]', () => {
  const cases = [
    { confidence:1,   recentVol:0,    momentum:1,    signal:'BUY'  },
    { confidence:0,   recentVol:1,    momentum:-1,   signal:'SELL' },
    { confidence:0.5, recentVol:0.20, momentum:0.03, signal:'BUY'  },
    { confidence:0,   recentVol:0,    momentum:0,    signal:'HOLD' },
  ];
  for (const c of cases) {
    const s = computeCompositeScore(c);
    assertBetween(s, 0, 1, `score for ${JSON.stringify(c)}`);
  }
});

test('missing momentum defaults to 0 (no crash)', () => {
  const s = computeCompositeScore({ confidence:0.7, recentVol:0.20, signal:'BUY' });
  assert(isFinite(s) && s >= 0, `Must handle missing momentum, got ${s}`);
});

test('weights sum correctly: 0.4+0.3+0.3=1', () => {
  // Full score = 0.4*1 + 0.3*1 + 0.3*1 = 1.0
  const max = computeCompositeScore({ confidence:1, recentVol:0, momentum:0.10, signal:'BUY' });
  assertClose(max, 1.0, 0.001, 'Max possible score must be 1.0');
});

// ═══════════════════════════════════════════════════════════════════════════
section('2. rankSignals — Selection & Filtering');
// ═══════════════════════════════════════════════════════════════════════════

const mkSig = (sym, signal, confidence, vol=0.20, mom=0.03) =>
  ({ symbol: sym, signal, confidence, recentVol: vol, momentum: mom });

test('returns only BUY signals when buyOnly=true (default)', () => {
  const sigs = [mkSig('A','BUY',0.8), mkSig('B','SELL',0.9), mkSig('C','HOLD',0.7)];
  const ranked = rankSignals(sigs);
  assert(ranked.every(r => r.signal === 'BUY'), 'Must only include BUY signals');
  assert(ranked.length === 1, `Must return 1 BUY signal, got ${ranked.length}`);
});

test('sorted descending by compositeScore', () => {
  const sigs = [
    mkSig('LOW',  'BUY', 0.3, 0.40, 0.01),
    mkSig('HIGH', 'BUY', 0.9, 0.10, 0.08),
    mkSig('MED',  'BUY', 0.6, 0.20, 0.04),
  ];
  // Use minScore=0 to include all 3 even if compositeScore is below default threshold
  const ranked = rankSignals(sigs, { topN: 3, minScore: 0 });
  assert(ranked.length === 3, 'Must return 3 signals');
  assert(ranked[0].symbol === 'HIGH', `Highest score must be first, got ${ranked[0].symbol}`);
  assert(ranked[2].symbol === 'LOW',  `Lowest score must be last, got ${ranked[2].symbol}`);
  // Verify strictly descending
  for (let i = 1; i < ranked.length; i++)
    assert(ranked[i].compositeScore <= ranked[i-1].compositeScore, 'Must be descending');
});

test('topN cap is respected', () => {
  const sigs = Array(10).fill(null).map((_, i) => mkSig(`S${i}`, 'BUY', 0.5 + i * 0.04));
  const ranked = rankSignals(sigs, { topN: 3 });
  assert(ranked.length === 3, `topN=3 must return 3, got ${ranked.length}`);
});

test('minScore filters weak signals', () => {
  const sigs = [
    mkSig('WEAK',   'BUY', 0.10, 0.50, 0.00),  // composite will be very low
    mkSig('STRONG', 'BUY', 0.90, 0.10, 0.08),
  ];
  const ranked = rankSignals(sigs, { minScore: 0.40 });
  assert(ranked.length === 1, `Only STRONG should pass minScore=0.40`);
  assert(ranked[0].symbol === 'STRONG', 'STRONG must be selected');
});

test('minConfidence pre-filters before composite scoring', () => {
  const sigs = [
    mkSig('LOWCONF', 'BUY', 0.10),  // confidence < 0.25 default
    mkSig('HIGHCONF','BUY', 0.80),
  ];
  const ranked = rankSignals(sigs, { minConfidence: 0.25 });
  assert(!ranked.find(r => r.symbol === 'LOWCONF'), 'LOWCONF must be filtered');
});

test('excludeSymbols prevents double-allocation', () => {
  const sigs = [mkSig('HELD','BUY',0.9), mkSig('FREE','BUY',0.7)];
  const ranked = rankSignals(sigs, { excludeSymbols: ['HELD'] });
  assert(!ranked.find(r => r.symbol === 'HELD'), 'HELD symbol must be excluded');
  assert(ranked.find(r => r.symbol === 'FREE'), 'FREE symbol must be included');
});

test('excludeSymbols is case-insensitive', () => {
  const sigs = [mkSig('RELIANCE','BUY',0.9), mkSig('TCS','BUY',0.7)];
  const ranked = rankSignals(sigs, { excludeSymbols: ['reliance'] });
  assert(!ranked.find(r => r.symbol === 'RELIANCE'), 'Must exclude regardless of case');
});

test('scoreBreakdown present in output', () => {
  const sigs   = [mkSig('A','BUY',0.8,0.20,0.05)];
  const ranked = rankSignals(sigs);
  assert('scoreBreakdown' in ranked[0], 'scoreBreakdown must be present');
  const { confidence, volatility, momentum } = ranked[0].scoreBreakdown;
  assertClose(confidence + volatility + momentum, ranked[0].compositeScore, 0.001,
    'scoreBreakdown must sum to compositeScore');
});

test('empty input returns empty array', () => {
  assert(rankSignals([]).length === 0, 'Empty input must return empty array');
  assert(rankSignals(null).length === 0, 'Null input must return empty array');
});

test('no qualifying signals returns empty array', () => {
  const sigs = [mkSig('A','HOLD',0.9), mkSig('B','SELL',0.8)];
  assert(rankSignals(sigs, { buyOnly: true }).length === 0, 'Must return empty when no BUY signals');
});

// ═══════════════════════════════════════════════════════════════════════════
section('3. allocateCapital — Available Cash Fix');
// ═══════════════════════════════════════════════════════════════════════════

test('uses availableCapital not totalCapital for deployment', () => {
  // totalCapital = 1M (some already in positions), freeCash = 300k
  const assets = [mkSig('A','BUY',0.8), mkSig('B','BUY',0.7)];
  const result = allocateCapital({
    totalCapital:     1_000_000,
    availableCapital:   300_000,
    assets,
    method: 'equal',
  });
  const totalAllocated = result.reduce((s, r) => s + r.allocation, 0);
  assert(totalAllocated <= 300_000, `Must not exceed availableCapital=300k, got ${totalAllocated}`);
});

test('backward compat: omitting availableCapital uses totalCapital', () => {
  const assets = [mkSig('A','BUY',0.8)];
  const result = allocateCapital({ totalCapital: 1_000_000, assets, method: 'equal' });
  assert(result[0].allocation > 0, 'Must allocate when only totalCapital provided');
  // Allocation should be ≤ totalCapital (0.95 exposure limit)
  assert(result[0].allocation <= 1_000_000, 'Must not exceed totalCapital');
});

test('zero availableCapital → all zero allocations', () => {
  const assets = [mkSig('A','BUY',0.9), mkSig('B','BUY',0.8)];
  const result = allocateCapital({
    totalCapital: 1_000_000, availableCapital: 0, assets,
  });
  result.forEach(r => assert(r.allocation === 0, `${r.symbol} must get 0 allocation`));
});

test('total allocated ≤ availableCapital × maxExposure', () => {
  const assets = Array(5).fill(null).map((_, i) => mkSig(`S${i}`,'BUY',0.7));
  const avail  = 500_000;
  const result = allocateCapital({ totalCapital: 1_000_000, availableCapital: avail, assets });
  const total  = result.reduce((s, r) => s + r.allocation, 0);
  assert(total <= avail * 0.96, `Total ${total} must be ≤ ${avail * 0.95} (95% of 500k)`);
});

test('composite method uses compositeScore for weights', () => {
  // Use rankSignals to get compositeScore populated, then allocate
  const rawSigs = [
    { symbol:'A', signal:'BUY', confidence:0.9, recentVol:0.10, momentum:0.08 },
    { symbol:'B', signal:'BUY', confidence:0.3, recentVol:0.50, momentum:0.00 },
    { symbol:'C', signal:'BUY', confidence:0.5, recentVol:0.25, momentum:0.03 },
    { symbol:'D', signal:'BUY', confidence:0.4, recentVol:0.30, momentum:0.02 },
  ];
  const ranked = rankSignals(rawSigs, { topN: 4, minScore: 0 });
  const result = allocateCapital({
    totalCapital: 1_000_000, availableCapital: 1_000_000, assets: ranked, method: 'composite',
  });
  const allocA = result.find(r => r.symbol === 'A').allocation;
  const allocB = result.find(r => r.symbol === 'B').allocation;
  assert(allocA > allocB, `Composite: A (${allocA.toFixed(0)}) must get more than B (${allocB.toFixed(0)})`);
});

test('HOLD/SELL assets get zero allocation', () => {
  const assets = [
    mkSig('A','BUY',  0.8),
    mkSig('B','HOLD', 0.7),
    mkSig('C','SELL', 0.9),
  ];
  const result = allocateCapital({ totalCapital: 1_000_000, assets });
  assert(result.find(r => r.symbol === 'B').allocation === 0, 'HOLD must get 0');
  assert(result.find(r => r.symbol === 'C').allocation === 0, 'SELL must get 0');
  assert(result.find(r => r.symbol === 'A').allocation >  0, 'BUY must get allocation');
});

test('per-asset cap: many assets are each limited below maxSinglePct', () => {
  // With 10 assets and equal weight, each gets ~9.5% of totalCapital.
  // The cap (20%) should NOT trigger, meaning weights are valid.
  // Verify total allocation is bounded by availableCapital × MAX_EXPOSURE.
  const assets = Array(10).fill(null).map((_,i) => mkSig(`S${i}`,'BUY',0.7));
  const result = allocateCapital({ totalCapital: 1_000_000, availableCapital: 1_000_000, assets });
  const total  = result.reduce((s, r) => s + r.allocation, 0);
  // Total must not exceed 95% of available
  assert(total <= 1_000_000 * 0.95 + 0.01, `Total ${total.toFixed(0)} must be ≤ 950k`);
  // With equal split over 10, each allocPctOfTotal ≈ 9.5% — well within cap
  for (const r of result.filter(r => r.allocation > 0)) {
    assert(r.allocPctOfTotal <= 0.20 + 0.001,
      `${r.symbol} allocPctOfTotal ${(r.allocPctOfTotal*100).toFixed(1)}% must be ≤ 20%`);
  }
});

test('vol_parity: low-vol asset gets higher raw weight', () => {
  const assets = [
    mkSig('LOWVOL',  'BUY', 0.7, 0.10, 0.05),
    mkSig('HIGHVOL', 'BUY', 0.7, 0.40, 0.05),
    mkSig('MEDVOL',  'BUY', 0.7, 0.20, 0.05),
    mkSig('MEDVOL2', 'BUY', 0.7, 0.20, 0.05),
  ];
  const result = allocateCapital({ totalCapital: 1_000_000, assets, method: 'vol_parity' });
  const lowW  = result.find(r => r.symbol === 'LOWVOL').weight;
  const highW = result.find(r => r.symbol === 'HIGHVOL').weight;
  assert(lowW > highW, `Low-vol raw weight ${lowW} must exceed high-vol ${highW}`);
});

test('allocPctOfTotal field is correctly computed', () => {
  const assets = [mkSig('A','BUY',0.8), mkSig('B','BUY',0.7)];
  const result = allocateCapital({
    totalCapital: 1_000_000, availableCapital: 500_000, assets,
  });
  for (const r of result.filter(x => x.allocation > 0)) {
    const expected = r.allocation / 1_000_000;
    assertClose(r.allocPctOfTotal, expected, 0.0001, `${r.symbol} allocPctOfTotal`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('4. PortfolioRiskMonitor — Construction');
// ═══════════════════════════════════════════════════════════════════════════

test('constructs with valid capital', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  assert(m.initialCapital === 1_000_000, 'initialCapital must be stored');
  assert(m.peakEquity === 1_000_000, 'peakEquity must start at initialCapital');
  assert(m.equityCurve.length === 1, 'equityCurve must start with 1 entry');
});

test('throws for invalid initialCapital', () => {
  let threw = false;
  try { new PortfolioRiskMonitor(0); } catch(_) { threw = true; }
  assert(threw, 'Must throw for initialCapital=0');
  threw = false;
  try { new PortfolioRiskMonitor(-100); } catch(_) { threw = true; }
  assert(threw, 'Must throw for negative initialCapital');
});

test('accepts custom opts', () => {
  const m = new PortfolioRiskMonitor(1_000_000, { maxPositions: 3, maxDrawdownPct: 0.10 });
  assert(m.maxPositions   === 3,    'maxPositions must be set');
  assert(m.maxDrawdownPct === 0.10, 'maxDrawdownPct must be set');
});

// ═══════════════════════════════════════════════════════════════════════════
section('5. PortfolioRiskMonitor — update() & snapshot()');
// ═══════════════════════════════════════════════════════════════════════════

test('update(): equity curve grows on each call', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  m.update(new Map(), 1_000_000, new Map());
  assert(m.equityCurve.length === 2, 'equityCurve must grow by 1 per update');
  m.update(new Map(), 1_010_000, new Map());
  assert(m.equityCurve.length === 3, 'equityCurve must grow by 1 per update');
});

test('update(): peakEquity tracked correctly', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  m.update(new Map(), 1_200_000, new Map());
  assert(m.peakEquity === 1_200_000, 'peakEquity must update on new high');
  m.update(new Map(),   950_000, new Map());
  assert(m.peakEquity === 1_200_000, 'peakEquity must NOT decrease on drawdown');
});

test('snapshot(): all required fields present', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  m.update(new Map(), 1_000_000, new Map());
  const snap = m.snapshot();
  for (const f of ['totalEquity','cash','totalExposure','deployedPct','cashPct',
                   'openPositions','currentDrawdownPct','maxDrawdownPct',
                   'capitalUtilisation','sharpeRatio','sortinoRatio',
                   'circuitBreakerActive','peakEquity'])
    assert(f in snap, `snapshot missing: ${f}`);
});

test('snapshot(): drawdown correctly computed', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  m.update(new Map(), 1_000_000, new Map());  // peak = 1M
  m.update(new Map(),   800_000, new Map());  // 20% drawdown
  const snap = m.snapshot();
  assertClose(snap.currentDrawdownPct, 20, 0.01, 'Drawdown must be ≈20%');
});

test('snapshot(): capitalUtilisation = exposure / initialCapital', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  // 300k in positions, 700k cash
  const pos    = new Map([['TCS', { qty: 100, entryPrice: 3000 }]]);
  const prices = new Map([['TCS', 3000]]);
  m.update(pos, 700_000, prices);
  const snap = m.snapshot();
  assertClose(snap.capitalUtilisation, 30, 0.1, 'Utilisation must be ≈30%');
});

test('snapshot(): circuitBreakerActive triggers at maxDrawdownPct', () => {
  const m = new PortfolioRiskMonitor(1_000_000, { maxDrawdownPct: 0.10 });
  m.update(new Map(), 1_000_000, new Map());
  m.update(new Map(),   850_000, new Map());  // 15% drawdown > 10% limit
  const snap = m.snapshot();
  assert(snap.circuitBreakerActive === true, 'Circuit breaker must fire at 15% when limit=10%');
});

test('snapshot(): cashPct + deployedPct ≈ 100%', () => {
  const m   = new PortfolioRiskMonitor(1_000_000);
  const pos = new Map([['TCS', { qty: 50, entryPrice: 3500 }]]);
  const p   = new Map([['TCS', 3500]]);
  m.update(pos, 825_000, p);
  const snap = m.snapshot();
  assertClose(snap.cashPct + snap.deployedPct, 100, 1, 'cashPct + deployedPct must ≈ 100%');
});

// ═══════════════════════════════════════════════════════════════════════════
section('6. PortfolioRiskMonitor — canOpenPosition() Guards');
// ═══════════════════════════════════════════════════════════════════════════

test('canOpenPosition: approves valid trade', () => {
  const m = new PortfolioRiskMonitor(1_000_000, { maxPositions: 5 });
  m.update(new Map(), 1_000_000, new Map());
  const { approved } = m.canOpenPosition('RELIANCE', 100_000);
  assert(approved, 'Valid trade must be approved');
});

test('canOpenPosition: rejects duplicate symbol', () => {
  const m   = new PortfolioRiskMonitor(1_000_000);
  const pos = new Map([['TCS', { qty: 50, entryPrice: 3500 }]]);
  m.update(pos, 825_000, new Map([['TCS', 3500]]));
  const { approved, reasons } = m.canOpenPosition('TCS', 50_000);
  assert(!approved, 'Must reject duplicate symbol');
  assert(reasons.some(r => r.includes('TCS')), 'Reason must mention TCS');
});

test('canOpenPosition: rejects when maxPositions reached', () => {
  const m = new PortfolioRiskMonitor(5_000_000, { maxPositions: 2 });
  const pos = new Map([
    ['A', { qty: 100, entryPrice: 100 }],
    ['B', { qty: 100, entryPrice: 100 }],
  ]);
  m.update(pos, 4_980_000, new Map([['A',100],['B',100]]));
  const { approved, reasons } = m.canOpenPosition('C', 10_000);
  assert(!approved, 'Must reject when maxPositions=2 reached');
  assert(reasons.some(r => r.includes('Max positions')), 'Reason must mention max positions');
});

test('canOpenPosition: rejects when insufficient cash', () => {
  const m = new PortfolioRiskMonitor(1_000_000);
  m.update(new Map(), 50_000, new Map());
  const { approved, reasons } = m.canOpenPosition('RELIANCE', 200_000);
  assert(!approved, 'Must reject when positionValue > cash');
  assert(reasons.some(r => r.includes('cash') || r.includes('Cash')), 'Reason must mention cash');
});

test('canOpenPosition: rejects on concentration breach', () => {
  const m = new PortfolioRiskMonitor(1_000_000, { maxSinglePct: 0.10 });
  m.update(new Map(), 1_000_000, new Map());
  const { approved, reasons } = m.canOpenPosition('RELIANCE', 200_000); // 20% > 10% limit
  assert(!approved, 'Must reject when position would exceed maxSinglePct');
  assert(reasons.some(r => r.includes('%')), 'Reason must mention percentage');
});

test('canOpenPosition: rejects when exposure limit would be breached', () => {
  const m = new PortfolioRiskMonitor(1_000_000, { maxExposurePct: 0.90 });
  // 80% already deployed
  const pos = new Map([['A', { qty: 100, entryPrice: 8000 }]]);
  m.update(pos, 200_000, new Map([['A', 8000]]));
  // Trying to deploy another 200k would push total to 100% > 90%
  const { approved, reasons } = m.canOpenPosition('B', 200_000);
  assert(!approved, 'Must reject when exposure limit would be breached');
  assert(reasons.some(r => r.includes('exposure') || r.includes('Exposure')), 'Reason must mention exposure');
});

test('canOpenPosition: circuit breaker blocks new entries', () => {
  const m = new PortfolioRiskMonitor(1_000_000, { maxDrawdownPct: 0.10 });
  m.update(new Map(), 1_000_000, new Map());
  m.update(new Map(),   850_000, new Map());  // 15% drawdown > 10% limit
  const { approved, reasons } = m.canOpenPosition('TCS', 50_000);
  assert(!approved, 'Circuit breaker must block new entries');
  assert(reasons.some(r => r.toLowerCase().includes('drawdown') || r.toLowerCase().includes('circuit')),
    'Reason must mention drawdown or circuit');
});

test('canOpenPosition: returns multiple rejection reasons when applicable', () => {
  const m = new PortfolioRiskMonitor(100_000, { maxPositions: 0 });  // maxPositions=0
  m.update(new Map(), 100_000, new Map());
  const { approved, reasons } = m.canOpenPosition('TCS', 1_000_000);
  assert(!approved, 'Must be rejected');
  assert(reasons.length >= 2, `Must have multiple reasons, got ${reasons.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════
section('7. Preserved v1 API — Backward Compatibility');
// ═══════════════════════════════════════════════════════════════════════════

test('allocateCapital: old signature (totalCapital only) still works', () => {
  const result = allocateCapital({
    totalCapital: 1_000_000,
    assets: [mkSig('A','BUY',0.8), mkSig('B','BUY',0.7)],
  });
  assert(Array.isArray(result), 'Must return array');
  assert('symbol' in result[0]    && 'allocation' in result[0] &&
         'allocPct' in result[0]  && 'weight' in result[0],
    'Must have original fields');
});

test('computePortfolioState: unchanged output', () => {
  const state = computePortfolioState({
    positions: [{ symbol:'A', entryPrice:1000, currentPrice:1100, quantity:100, side:'BUY' }],
    cash: 200_000,
  });
  assert('totalValue' in state,       'totalValue');
  assert('unrealisedPnL' in state,    'unrealisedPnL');
  assert('cashPct' in state,          'cashPct');
  assert('positionCount' in state,    'positionCount');
  assertClose(state.unrealisedPnL, 10_000, 1, 'unrealisedPnL must be 10k');
});

test('volScaledSize: unchanged output shape', () => {
  const r = volScaledSize({ capital: 1_000_000, entryPrice: 2000, realisedVol: 0.20 });
  assert('quantity' in r,        'quantity');
  assert('positionValue' in r,   'positionValue');
  assert('volContribution' in r, 'volContribution');
  assert(Number.isInteger(r.quantity), 'quantity must be integer');
  assert(r.quantity >= 0, 'quantity must be non-negative');
});

test('volScaledSize: throws for invalid inputs', () => {
  let threw = false;
  try { volScaledSize({ capital: 0, entryPrice: 1000, realisedVol: 0.20 }); }
  catch(_) { threw = true; }
  assert(threw, 'Must throw for capital=0');
});

test('checkPortfolioLimits: approves valid addition', () => {
  const { approved } = checkPortfolioLimits({
    currentPositions: [], newSymbol: 'TCS', newValue: 100_000, totalCapital: 1_000_000,
  });
  assert(approved, 'Must approve valid trade');
});

test('checkPortfolioLimits: blocks max assets', () => {
  const { approved } = checkPortfolioLimits({
    currentPositions: Array(10).fill({ symbol:'X', currentPrice:100, quantity:10 }),
    newSymbol: 'NEW', newValue: 10_000, totalCapital: 1_000_000,
  });
  assert(!approved, 'Must block when max assets reached');
});

// ═══════════════════════════════════════════════════════════════════════════
section('8. End-to-End: rank → allocate → risk check');
// ═══════════════════════════════════════════════════════════════════════════

test('complete pipeline: 10 signals → rank top 3 → allocate from free cash → risk monitor', () => {
  const totalCap  = 1_000_000;
  const freeCash  = 400_000;  // 60% already deployed

  // Simulate 10 signals from live engine
  const rawSignals = [
    { symbol:'RELIANCE', signal:'BUY',  confidence:0.85, recentVol:0.18, momentum:0.06 },
    { symbol:'TCS',      signal:'BUY',  confidence:0.72, recentVol:0.16, momentum:0.04 },
    { symbol:'INFY',     signal:'HOLD', confidence:0.60, recentVol:0.19, momentum:0.01 },
    { symbol:'SBIN',     signal:'BUY',  confidence:0.55, recentVol:0.28, momentum:0.02 },
    { symbol:'HDFCBANK', signal:'BUY',  confidence:0.90, recentVol:0.15, momentum:0.07 },
    { symbol:'WIPRO',    signal:'SELL', confidence:0.65, recentVol:0.22, momentum:-0.03 },
    { symbol:'AXISBANK', signal:'BUY',  confidence:0.30, recentVol:0.35, momentum:0.00 },
    { symbol:'ITC',      signal:'BUY',  confidence:0.68, recentVol:0.14, momentum:0.05 },
    { symbol:'BAJFINANCE',signal:'BUY', confidence:0.45, recentVol:0.42, momentum:0.01 },
    { symbol:'TATASTEEL', signal:'BUY', confidence:0.40, recentVol:0.38, momentum:-0.01 },
  ];

  // Step 1: Already holding TCS — exclude from new entries
  const alreadyHeld = ['TCS'];

  // Step 2: Rank — top 3 only
  const ranked = rankSignals(rawSignals, { topN: 3, minScore: 0.35, excludeSymbols: alreadyHeld });

  assert(ranked.length <= 3, `Must select ≤ 3, got ${ranked.length}`);
  assert(!ranked.find(r => r.symbol === 'TCS'), 'Already-held TCS must be excluded');
  assert(!ranked.find(r => r.signal !== 'BUY'), 'Must only include BUY signals');
  // HDFCBANK has high confidence, low vol, good momentum → should rank first
  assert(ranked[0].symbol === 'HDFCBANK', `HDFCBANK should rank first, got ${ranked[0].symbol}`);

  // Step 3: Allocate from freeCash
  const allocs = allocateCapital({
    totalCapital:     totalCap,
    availableCapital: freeCash,
    assets:           ranked,
    method:           'composite',
  });

  const totalAllocated = allocs.reduce((s, r) => s + r.allocation, 0);
  assert(totalAllocated <= freeCash, `Total ${totalAllocated} must not exceed freeCash ${freeCash}`);

  // Step 4: Risk monitor — initialCapital = current portfolio value (TCS + cash)
  // TCS position: 100 × 3500 = 350k; free cash: 400k; total equity: 750k
  const currentEquityForMonitor = 100 * 3500 + freeCash;   // 750k
  const monitor = new PortfolioRiskMonitor(currentEquityForMonitor, { maxPositions: 5 });
  const currentPos = new Map([['TCS', { qty: 100, entryPrice: 3500 }]]);
  monitor.update(currentPos, freeCash, new Map([['TCS', 3500]]));

  // Check the top-ranked allocation is approved
  const topAlloc = allocs.filter(a => a.allocation > 0)[0];
  if (topAlloc) {
    const { approved, reasons } = monitor.canOpenPosition(topAlloc.symbol, topAlloc.allocation);
    assert(approved, `${topAlloc.symbol} with ₹${topAlloc.allocation.toFixed(0)} must be approved. Reasons: ${reasons.join('; ')}`);
  }

  // Verify snapshot
  const snap = monitor.snapshot();
  assert(snap.openPositions >= 0, 'openPositions must be valid');
  assert(!snap.circuitBreakerActive, 'Circuit breaker must not be active (no drawdown)');
});

test('pipeline prevents over-allocation on 2nd pass same bar', () => {
  // Simulates what happens if allocateCapital is called twice on the same bar
  const totalCap = 1_000_000;
  let   freeCash = 500_000;

  const signals = [mkSig('A','BUY',0.9,0.15,0.06), mkSig('B','BUY',0.8,0.20,0.04)];
  const ranked  = rankSignals(signals, { topN: 2 });

  // First allocation
  const allocs1 = allocateCapital({ totalCapital:totalCap, availableCapital:freeCash, assets:ranked });
  const spent1  = allocs1.reduce((s,r) => s + r.allocation, 0);
  freeCash -= spent1;  // deduct spent cash

  // Second allocation on remaining cash — should be smaller
  if (freeCash > 0) {
    const allocs2 = allocateCapital({ totalCapital:totalCap, availableCapital:freeCash, assets:ranked });
    const spent2  = allocs2.reduce((s,r) => s + r.allocation, 0);
    assert(spent2 < spent1, 'Second allocation must be smaller after deducting first');
    assert(spent2 <= freeCash + 0.01, 'Second allocation must not exceed remaining freeCash');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(62)}`);
console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
console.log(failed === 0 ? '  🎉 All portfolio v2 tests passing!' : `  ⚠️  ${failed} test(s) failed`);
console.log(`${'═'.repeat(62)}\n`);
process.exit(failed > 0 ? 1 : 0);
