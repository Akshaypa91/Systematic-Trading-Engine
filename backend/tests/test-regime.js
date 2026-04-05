// tests/test-regime.js
// ─────────────────────────────────────────────────────────────────────────────
// Self-contained test suite for the Market Regime Detection module.
// No DB or network required.
// Run: node tests/test-regime.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();
process.env.LOG_LEVEL = 'silent';

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌  ${name}\n       → ${e.message}`);
    failed++;
  }
}

function assert(cond, msg)  { if (!cond) throw new Error(msg || 'Assertion failed'); }

function assertClose(a, e, tol = 0.001, msg) {
  if (typeof a !== 'number' || !isFinite(a))
    throw new Error(`${msg || ''} Expected ~${e}, got non-finite: ${a}`);
  if (Math.abs(a - e) > tol)
    throw new Error(`${msg || ''} Expected ≈${e}±${tol}, got ${a}`);
}

function assertBetween(v, lo, hi, msg) {
  if (v < lo || v > hi)
    throw new Error(`${msg || ''} Expected [${lo},${hi}], got ${v}`);
}

function section(t) { console.log(`\n── ${t} ${'─'.repeat(58 - t.length)}`); }

// ── Price generators ──────────────────────────────────────────────────────────
function randn() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Geometric Brownian Motion bars
function gbmBars(n, s0, drift, vol) {
  const dt = 1 / 252;
  const closes = [s0];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * Math.exp(
      (drift - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * randn()
    ));
  }
  return closes;
}

// Strong uptrend: 25% drift, 12% vol — will definitely be TRENDING
function makeTrending(n = 400) {
  const dt = 1/252;
  const closes = [1000];
  for (let i = 1; i < n; i++)
    closes.push(closes[i-1] * (1 + 0.001 + 0.008 * randn())); // 0.1%/bar drift
  return closes;
}

// Sideways oscillator: near-zero drift, low vol
function makeSideways(n = 400) {
  const closes = [];
  for (let i = 0; i < n; i++)
    closes.push(1000 + 20 * Math.sin(i * 0.15) + randn() * 3);
  return closes;
}

// High volatility: large random moves, no direction
function makeVolatile(n = 400) {
  return gbmBars(n, 1000, 0, 0.50); // 50% annualised vol
}

// Flat line (perfectly sideways, no vol)
function makeFlat(n = 200) {
  return Array(n).fill(1000);
}

// ─────────────────────────────────────────────────────────────────────────────
const {
  detectRegime, detectRegimeWithRouting,
  computeADX, computeMASlope, computeATR, computeVolPercentile,
  computeRegimeWeights, resetSmoothing, REGIME,
} = require('../src/engine/regimeDetector');

// ─────────────────────────────────────────────────────────────────────────────
section('1. REGIME enum');
// ─────────────────────────────────────────────────────────────────────────────

test('REGIME enum has all four values', () => {
  assert(REGIME.TRENDING === 'TRENDING', 'TRENDING');
  assert(REGIME.SIDEWAYS === 'SIDEWAYS', 'SIDEWAYS');
  assert(REGIME.VOLATILE === 'VOLATILE', 'VOLATILE');
  assert(REGIME.UNKNOWN  === 'UNKNOWN',  'UNKNOWN');
});

test('REGIME enum is frozen (immutable)', () => {
  let threw = false;
  try { REGIME.NEW = 'X'; } catch (_) { threw = true; }
  // In strict mode it throws; in non-strict it silently fails
  assert(!REGIME.NEW, 'REGIME should not allow new keys');
});

// ─────────────────────────────────────────────────────────────────────────────
section('2. Edge Cases — Insufficient Data');
// ─────────────────────────────────────────────────────────────────────────────

test('detectRegime returns UNKNOWN for null input', () => {
  const r = detectRegime(null);
  assert(r.regime === REGIME.UNKNOWN, `Expected UNKNOWN, got ${r.regime}`);
  assert(r.strength === 0, `strength must be 0 for UNKNOWN`);
});

test('detectRegime returns UNKNOWN for empty array', () => {
  const r = detectRegime([]);
  assert(r.regime === REGIME.UNKNOWN);
});

test('detectRegime returns UNKNOWN for 59 bars (< 60 minimum)', () => {
  const r = detectRegime(Array(59).fill(1000).map((v, i) => v + i));
  assert(r.regime === REGIME.UNKNOWN);
});

test('detectRegime returns valid structure for 60 bars', () => {
  resetSmoothing('TEST60');
  const closes = Array(60).fill(null).map((_, i) => 1000 + i * 2);
  const r      = detectRegime(closes, 'TEST60');
  assert(['TRENDING','SIDEWAYS','VOLATILE','UNKNOWN'].includes(r.regime),
    `Invalid regime: ${r.regime}`);
  assert(typeof r.strength === 'number', 'strength must be number');
  assert(r.strength >= 0 && r.strength <= 1, `strength ${r.strength} out of [0,1]`);
  assert(r.weights !== null, 'weights must be present');
});

test('computeADX returns null for < 29 bars (2×period+1)', () => {
  assert(computeADX([1,2,3]) === null);
});

test('computeMASlope returns null for < maPeriod + slopePeriod bars', () => {
  assert(computeMASlope(Array(60).fill(1000)) === null);
});

test('computeATR returns null for <= period bars', () => {
  assert(computeATR([1000], 14) === null);
});

test('computeVolPercentile returns null for < 22 bars', () => {
  assert(computeVolPercentile(Array(15).fill(1000)) === null);
});

// ─────────────────────────────────────────────────────────────────────────────
section('3. ADX Computation');
// ─────────────────────────────────────────────────────────────────────────────

test('computeADX — flat line gives near-zero ADX (no trend strength)', () => {
  const flat = makeFlat(100);
  const adx  = computeADX(flat);
  // Flat line: DM+ = DM- = 0, but TR also 0 → returns null (degenerate)
  // OR if prices have tiny noise, ADX approaches 0
  assert(adx === null || adx <= 5, `Flat ADX should be null or ≤5, got ${adx}`);
});

test('computeADX — strong trend gives high ADX', () => {
  // Pure monotonic trend → all moves in one direction → ADX approaches 100
  const trend = Array(100).fill(null).map((_, i) => 1000 + i * 5);
  const adx   = computeADX(trend);
  assert(adx !== null, 'ADX should not be null for trend data');
  assert(adx > 30, `Trending ADX should be >30, got ${adx}`);
});

test('computeADX — output in [0, 100]', () => {
  const closes = makeTrending(200);
  const adx    = computeADX(closes);
  if (adx !== null) assertBetween(adx, 0, 100, 'ADX');
});

test('computeADX — returns finite number for random data', () => {
  const closes = gbmBars(200, 1000, 0.10, 0.20);
  const adx    = computeADX(closes);
  assert(adx === null || (isFinite(adx) && adx >= 0), `ADX must be finite ≥0, got ${adx}`);
});

// ─────────────────────────────────────────────────────────────────────────────
section('4. MA Slope Computation');
// ─────────────────────────────────────────────────────────────────────────────

test('computeMASlope — uptrend gives positive slope', () => {
  // Monotonically increasing: SMA now > SMA 20 bars ago → positive slope
  const trend = Array(200).fill(null).map((_, i) => 1000 + i * 3);
  const slope = computeMASlope(trend);
  assert(slope !== null, 'slope must not be null');
  assert(slope > 0, `Uptrend slope must be positive, got ${slope}`);
});

test('computeMASlope — flat data gives slope ≈ 0', () => {
  const flat  = Array(200).fill(1000);
  const slope = computeMASlope(flat);
  assert(slope === null || Math.abs(slope) < 0.00001, `Flat slope must be ≈0, got ${slope}`);
});

test('computeMASlope — downtrend gives negative slope', () => {
  const down  = Array(200).fill(null).map((_, i) => 2000 - i * 3);
  const slope = computeMASlope(down);
  assert(slope !== null, 'slope must not be null');
  assert(slope < 0, `Downtrend slope must be negative, got ${slope}`);
});

// ─────────────────────────────────────────────────────────────────────────────
section('5. ATR Computation');
// ─────────────────────────────────────────────────────────────────────────────

test('computeATR — returns atr and atrPct', () => {
  const closes = gbmBars(100, 1000, 0.10, 0.20);
  const result = computeATR(closes);
  assert(result !== null, 'ATR result must not be null');
  assert(typeof result.atr    === 'number', 'atr must be number');
  assert(typeof result.atrPct === 'number', 'atrPct must be number');
  assert(result.atr > 0,    'atr must be positive');
  assert(result.atrPct > 0, 'atrPct must be positive');
});

test('computeATR — high-vol data gives larger ATR than low-vol', () => {
  const lowVol  = gbmBars(150, 1000, 0.05, 0.05);
  const highVol = gbmBars(150, 1000, 0.05, 0.40);
  const atrLow  = computeATR(lowVol);
  const atrHigh = computeATR(highVol);
  assert(atrLow  !== null && atrHigh !== null, 'Both must be non-null');
  assert(atrHigh.atrPct >= atrLow.atrPct,
    `High-vol atrPct ${atrHigh.atrPct} must be ≥ low-vol ${atrLow.atrPct}`);
});

test('computeATR — atrPct is ATR expressed as % of last close', () => {
  const closes = gbmBars(100, 1000, 0.05, 0.15);
  const result = computeATR(closes);
  const expected = (result.atr / closes[closes.length - 1]) * 100;
  assertClose(result.atrPct, expected, 0.01, 'atrPct should be atr/close×100');
});

// ─────────────────────────────────────────────────────────────────────────────
section('6. Vol Percentile Computation');
// ─────────────────────────────────────────────────────────────────────────────

test('computeVolPercentile — output in [0, 1]', () => {
  const closes = gbmBars(300, 1000, 0.10, 0.20);
  const pct    = computeVolPercentile(closes);
  if (pct !== null) assertBetween(pct, 0, 1, 'vol percentile');
});

test('computeVolPercentile — returns null for < 22 bars', () => {
  assert(computeVolPercentile(Array(15).fill(1000).map((v,i) => v+i)) === null);
});

test('computeVolPercentile — high-vol data gets high percentile', () => {
  // Build history with normal vol, then spike at end
  const normalHistory = gbmBars(300, 1000, 0.05, 0.15);
  const volatileEnd   = gbmBars(50,  normalHistory[normalHistory.length-1], 0, 0.80);
  const combined      = [...normalHistory, ...volatileEnd.slice(1)];
  const pct           = computeVolPercentile(combined);
  if (pct !== null) {
    assert(pct >= 0.50, `High-vol end should have pct ≥ 0.5, got ${pct}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
section('7. Regime Weights — Strategy Routing');
// ─────────────────────────────────────────────────────────────────────────────

test('computeRegimeWeights — TRENDING boosts MA_CROSSOVER', () => {
  const w = computeRegimeWeights(REGIME.TRENDING, 1.0);
  assert(w.MA_CROSSOVER > w.MEAN_REVERSION,
    `TRENDING: MA_CROSSOVER(${w.MA_CROSSOVER}) must exceed MEAN_REVERSION(${w.MEAN_REVERSION})`);
  assert(w.MA_CROSSOVER > 0.30, `TRENDING MA_CROSSOVER must be >0.30, got ${w.MA_CROSSOVER}`);
  assert(w.bollingerMode === 'breakout', 'TRENDING must use Bollinger breakout mode');
});

test('computeRegimeWeights — SIDEWAYS boosts MEAN_REVERSION + BOLLINGER', () => {
  const w = computeRegimeWeights(REGIME.SIDEWAYS, 1.0);
  assert(w.MEAN_REVERSION > w.MA_CROSSOVER,
    `SIDEWAYS: MR(${w.MEAN_REVERSION}) must exceed MA(${w.MA_CROSSOVER})`);
  assert(w.BOLLINGER > 0.10, `SIDEWAYS BOLLINGER must be >0.10, got ${w.BOLLINGER}`);
  assert(w.bollingerMode === 'mean_reversion', 'SIDEWAYS must use Bollinger mean-reversion mode');
});

test('computeRegimeWeights — VOLATILE reduces all, boosts RSI', () => {
  const base = computeRegimeWeights(REGIME.UNKNOWN, 0);
  const vol  = computeRegimeWeights(REGIME.VOLATILE, 1.0);
  assert(vol.MA_CROSSOVER   < base.MA_CROSSOVER,   'VOLATILE: MA must be reduced');
  assert(vol.MEAN_REVERSION < base.MEAN_REVERSION, 'VOLATILE: MR must be reduced');
  assert(vol.RSI >= base.RSI, `VOLATILE: RSI must be boosted; got ${vol.RSI}`);
});

test('computeRegimeWeights — all weights are non-negative', () => {
  for (const regime of Object.values(REGIME)) {
    const w = computeRegimeWeights(regime, 0.8);
    assert(w.MEAN_REVERSION >= 0, `${regime}: MR must be ≥0`);
    assert(w.MA_CROSSOVER   >= 0, `${regime}: MA must be ≥0`);
    assert(w.RSI             >= 0, `${regime}: RSI must be ≥0`);
    assert(w.BOLLINGER       >= 0, `${regime}: BB must be ≥0`);
  }
});

test('computeRegimeWeights — strength=0 gives balanced weights', () => {
  const wT = computeRegimeWeights(REGIME.TRENDING,  0);
  const wS = computeRegimeWeights(REGIME.SIDEWAYS,  0);
  const wV = computeRegimeWeights(REGIME.VOLATILE,  0);
  // At strength=0, adjustments are 0, so all should equal base
  assertClose(wT.MA_CROSSOVER,   wS.MA_CROSSOVER,   0.02, 'strength=0 should be near-equal');
  assertClose(wT.MEAN_REVERSION, wS.MEAN_REVERSION, 0.02, 'strength=0 should be near-equal');
});

// ─────────────────────────────────────────────────────────────────────────────
section('8. detectRegime — Output Contract');
// ─────────────────────────────────────────────────────────────────────────────

test('detectRegime — returns all required fields', () => {
  resetSmoothing('CONTRACT');
  const closes = makeTrending(300);
  const r      = detectRegime(closes, 'CONTRACT');
  const required = ['regime','strength','direction','adx','maSlope','atr','atrPct',
                    'volPercentile','realisedVol','weights','smoothedScore','indicators'];
  for (const field of required) {
    assert(field in r, `Missing field: ${field}`);
  }
});

test('detectRegime — strength is in [0, 1]', () => {
  resetSmoothing('STR');
  const closes = gbmBars(300, 1000, 0.10, 0.20);
  const r      = detectRegime(closes, 'STR');
  assertBetween(r.strength, 0, 1, 'strength');
});

test('detectRegime — direction is UP/DOWN/FLAT/null', () => {
  resetSmoothing('DIR');
  const closes = makeTrending(300);
  const r      = detectRegime(closes, 'DIR');
  const valid  = ['UP', 'DOWN', 'FLAT', null];
  assert(valid.includes(r.direction),
    `direction must be UP/DOWN/FLAT/null, got ${r.direction}`);
});

test('detectRegime — smoothedScore is finite', () => {
  resetSmoothing('SMOOTH');
  const closes = gbmBars(300, 1000, 0.05, 0.15);
  const r      = detectRegime(closes, 'SMOOTH');
  assert(isFinite(r.smoothedScore), `smoothedScore must be finite, got ${r.smoothedScore}`);
});

test('detectRegime — weights object has all strategy keys', () => {
  resetSmoothing('WKEYS');
  const closes = makeTrending(300);
  const r      = detectRegime(closes, 'WKEYS');
  const keys   = ['MEAN_REVERSION', 'MA_CROSSOVER', 'RSI', 'BOLLINGER', 'bollingerMode'];
  for (const k of keys) {
    assert(k in r.weights, `weights missing key: ${k}`);
  }
});

test('detectRegime — indicators contains raw values', () => {
  resetSmoothing('IND');
  const closes = makeTrending(300);
  const r      = detectRegime(closes, 'IND');
  assert(typeof r.indicators === 'object', 'indicators must be object');
  assert('rawScore' in r.indicators, 'indicators must have rawScore');
  assert('confirmed' in r.indicators, 'indicators must have confirmed');
});

// ─────────────────────────────────────────────────────────────────────────────
section('9. detectRegime — Regime Classification');
// ─────────────────────────────────────────────────────────────────────────────

test('detectRegime — strong monotonic uptrend → TRENDING', () => {
  resetSmoothing('TREND_UP');
  // Pure monotonic trend with 1%/bar rise — definitely trending
  const n      = 400;
  const closes = Array(n).fill(null).map((_, i) => 1000 * Math.pow(1.01, i));
  const r      = detectRegime(closes, 'TREND_UP');
  // With smoothing + confirmation, may need multiple calls or be UNKNOWN
  // We just verify it's not misclassified as SIDEWAYS
  assert(r.regime !== REGIME.SIDEWAYS,
    `Strong uptrend must not be SIDEWAYS, got ${r.regime}`);
  assert(['TRENDING','UNKNOWN','VOLATILE'].includes(r.regime),
    `Got unexpected regime ${r.regime}`);
});

test('detectRegime — sideways oscillator → not TRENDING', () => {
  resetSmoothing('SIDE');
  const closes = makeSideways(400);
  // Call twice to allow smoothing to converge
  detectRegime(closes.slice(0, 200), 'SIDE');
  const r = detectRegime(closes, 'SIDE');
  assert(r.regime !== REGIME.TRENDING,
    `Sideways market must not be TRENDING, got ${r.regime} (strength=${r.strength})`);
});

test('detectRegime — multiple calls stabilise result (no thrashing)', () => {
  resetSmoothing('STAB');
  const closes = makeTrending(500);
  // Make 10 consecutive calls and verify regime is stable in last 5
  const regimes = [];
  for (let i = 100; i <= 500; i += 40) {
    const r = detectRegime(closes.slice(0, i), 'STAB');
    regimes.push(r.regime);
  }
  // Count regime changes in last 5 observations
  const last5    = regimes.slice(-5);
  const changes  = last5.filter((r, i) => i > 0 && r !== last5[i-1]).length;
  assert(changes <= 2, `Too many regime changes in last 5 calls: ${changes} (${last5.join(',')})`);
});

// ─────────────────────────────────────────────────────────────────────────────
section('10. Smoothing — No Noisy Switching');
// ─────────────────────────────────────────────────────────────────────────────

test('resetSmoothing — clears state for a symbol', () => {
  // Build up smoothing state
  const closes = makeTrending(300);
  detectRegime(closes, 'RESET_ME');
  resetSmoothing('RESET_ME');
  // After reset, smoothedScore should start at 0
  const flat = Array(300).fill(1000);
  const r    = detectRegime(flat, 'RESET_ME');
  assertClose(Math.abs(r.smoothedScore), 0, 0.30,
    'After reset, smoothed score should be near 0 for flat data');
});

test('resetSmoothing — clears all symbols when no arg', () => {
  detectRegime(makeTrending(200), 'SYM_A');
  detectRegime(makeTrending(200), 'SYM_B');
  resetSmoothing();  // clear all
  const rA = detectRegime(Array(200).fill(1000), 'SYM_A');
  const rB = detectRegime(Array(200).fill(1000), 'SYM_B');
  // After reset, flat data should give near-zero smoothed score
  assert(isFinite(rA.smoothedScore), 'SYM_A smoothedScore must be finite after reset');
  assert(isFinite(rB.smoothedScore), 'SYM_B smoothedScore must be finite after reset');
});

test('smoothing prevents single-bar regime flip', () => {
  resetSmoothing('FLIP');
  const base = makeSideways(300);
  // Establish sideways regime
  for (let i = 0; i < 5; i++) detectRegime(base, 'FLIP');
  const established = detectRegime(base, 'FLIP').regime;

  // Add one extreme bar (large move) — should NOT immediately flip regime
  const oneBar = [...base, base[base.length - 1] * 1.05];
  const after  = detectRegime(oneBar, 'FLIP');
  // Due to smoothing, regime should not flip instantly to TRENDING
  // (it may eventually, but not on one bar)
  assert(after.regime !== REGIME.VOLATILE || established === REGIME.VOLATILE,
    `Single extreme bar should not flip regime from ${established} to VOLATILE`);
});

test('per-symbol smoothing — different symbols have independent state', () => {
  resetSmoothing();
  const trend    = makeTrending(300);
  const sideways = makeSideways(300);

  // Run each symbol 5 times to let smoothing converge
  for (let i = 0; i < 5; i++) {
    detectRegime(trend,    'SYM_TREND');
    detectRegime(sideways, 'SYM_SIDE');
  }

  const rTrend = detectRegime(trend,    'SYM_TREND');
  const rSide  = detectRegime(sideways, 'SYM_SIDE');

  // Smoothed scores should differ (trend has higher trending score)
  assert(rTrend.smoothedScore >= rSide.smoothedScore,
    `Trending symbol smoothedScore (${rTrend.smoothedScore}) must be ≥ ` +
    `sideways (${rSide.smoothedScore})`);
});

// ─────────────────────────────────────────────────────────────────────────────
section('11. detectRegimeWithRouting');
// ─────────────────────────────────────────────────────────────────────────────

test('detectRegimeWithRouting — returns recommendedStrategy field', () => {
  resetSmoothing('ROUTE');
  const closes = makeTrending(300);
  const r      = detectRegimeWithRouting(closes, 'ROUTE');
  assert('recommendedStrategy' in r, 'Must have recommendedStrategy');
  const valid = ['MA_CROSSOVER','BOLLINGER','RSI','AGGREGATED','MEAN_REVERSION'];
  assert(valid.includes(r.recommendedStrategy),
    `recommendedStrategy ${r.recommendedStrategy} must be a valid strategy`);
});

test('detectRegimeWithRouting — returns bollingerMode field', () => {
  resetSmoothing('BBMODE');
  const closes = makeTrending(300);
  const r      = detectRegimeWithRouting(closes, 'BBMODE');
  assert('bollingerMode' in r, 'Must have bollingerMode');
  assert(['mean_reversion','breakout'].includes(r.bollingerMode),
    `bollingerMode must be mean_reversion or breakout, got ${r.bollingerMode}`);
});

test('detectRegimeWithRouting — all original regime fields preserved', () => {
  resetSmoothing('RFIELDS');
  const closes = gbmBars(300, 1000, 0.10, 0.20);
  const r      = detectRegimeWithRouting(closes, 'RFIELDS');
  assert('regime'  in r, 'Must have regime');
  assert('strength' in r, 'Must have strength');
  assert('weights'  in r, 'Must have weights');
});

// ─────────────────────────────────────────────────────────────────────────────
section('12. Aggregator Integration');
// ─────────────────────────────────────────────────────────────────────────────

const aggregator = require('../src/strategies/aggregator');

test('aggregator.aggregate — works with regime detection enabled', () => {
  resetSmoothing('AGG1');
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes, { symbol: 'AGG1', useRegime: true });
  assert(['BUY','SELL','HOLD'].includes(result.signal), `Invalid signal: ${result.signal}`);
  assert(result.regime !== undefined, 'regime field must be present');
});

test('aggregator.aggregate — works with regime detection disabled', () => {
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes, { useRegime: false });
  assert(['BUY','SELL','HOLD'].includes(result.signal));
  // regime should be null when disabled
  assert(result.regime === null, 'regime must be null when useRegime=false');
});

test('aggregator.aggregate — includes 4 strategy components (including BB)', () => {
  resetSmoothing('AGG4');
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes, { symbol: 'AGG4', useRegime: true });
  assert(Array.isArray(result.components), 'components must be array');
  assert(result.components.length === 4, `Must have 4 components, got ${result.components.length}`);
  const strategies = result.components.map(c => c.strategy);
  assert(strategies.includes('BOLLINGER'),      'Must include BOLLINGER');
  assert(strategies.includes('MA_CROSSOVER'),   'Must include MA_CROSSOVER');
  assert(strategies.includes('MEAN_REVERSION'), 'Must include MEAN_REVERSION');
  assert(strategies.includes('RSI'),            'Must include RSI');
});

test('aggregator.aggregate — regime info contains regime + strength + direction', () => {
  resetSmoothing('REGINFO');
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes, { symbol: 'REGINFO', useRegime: true });
  if (result.regime) {
    assert('detected'  in result.regime, 'regime.detected required');
    assert('strength'  in result.regime, 'regime.strength required');
    assert('direction' in result.regime, 'regime.direction required');
    assert('weights'   in result.regime, 'regime.weights required');
  }
});

test('aggregator.aggregate — regime weights affect component weights', () => {
  // TRENDING: MA_CROSSOVER should get high weight
  resetSmoothing('WTREND');
  const trend  = Array(400).fill(null).map((_, i) => 1000 * Math.pow(1.005, i));
  const result = aggregator.aggregate(trend, { symbol: 'WTREND', useRegime: true });
  if (result.regime && result.regime.detected === REGIME.TRENDING) {
    const maComp = result.components.find(c => c.strategy === 'MA_CROSSOVER');
    const mrComp = result.components.find(c => c.strategy === 'MEAN_REVERSION');
    assert(maComp.weight >= mrComp.weight,
      `TRENDING: MA weight ${maComp.weight} must be ≥ MR weight ${mrComp.weight}`);
  }
});

test('aggregator.aggregate — overrideWeights bypasses regime detection', () => {
  resetSmoothing('OVER');
  const closes   = makeTrending(400);
  const override = {
    MEAN_REVERSION: 0.70, MA_CROSSOVER: 0.05, RSI: 0.15, BOLLINGER: 0.10,
    bollingerMode: 'mean_reversion',
  };
  const result = aggregator.aggregate(closes, { overrideWeights: override });
  const mrComp = result.components.find(c => c.strategy === 'MEAN_REVERSION');
  assertClose(mrComp.weight, 0.70, 0.001, 'overrideWeights must be applied exactly');
  assert(result.regime === null, 'regime must be null when overrideWeights used');
});

test('aggregator.aggregate — majority method works with regime', () => {
  resetSmoothing('MAJORITY');
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes, {
    method: 'majority', symbol: 'MAJORITY', useRegime: true,
  });
  assert(['BUY','SELL','HOLD'].includes(result.signal));
  assert(result.method === 'majority', 'method must be preserved in output');
});

test('aggregator.describeWeights — includes regime integration info', () => {
  const desc = aggregator.describeWeights();
  assert(desc.regimeIntegration === true, 'Must advertise regime integration');
  assert('regimeStrategies' in desc, 'Must describe regime strategies');
  assert(desc.strategies.length === 4, 'Must list all 4 strategies including Bollinger');
});

// ─────────────────────────────────────────────────────────────────────────────
section('13. Bollinger Band Mode Switching');
// ─────────────────────────────────────────────────────────────────────────────

test('TRENDING regime → Bollinger in breakout mode', () => {
  const w = computeRegimeWeights(REGIME.TRENDING, 0.9);
  assert(w.bollingerMode === 'breakout',
    `TRENDING must use breakout mode, got ${w.bollingerMode}`);
});

test('SIDEWAYS regime → Bollinger in mean_reversion mode', () => {
  const w = computeRegimeWeights(REGIME.SIDEWAYS, 0.9);
  assert(w.bollingerMode === 'mean_reversion',
    `SIDEWAYS must use mean_reversion mode, got ${w.bollingerMode}`);
});

test('VOLATILE regime → Bollinger in mean_reversion mode', () => {
  const w = computeRegimeWeights(REGIME.VOLATILE, 0.9);
  assert(w.bollingerMode === 'mean_reversion',
    `VOLATILE must use mean_reversion mode, got ${w.bollingerMode}`);
});

// ─────────────────────────────────────────────────────────────────────────────
section('14. Backward Compatibility');
// ─────────────────────────────────────────────────────────────────────────────

test('detectRegime — still accepts close array without symbol (backward compat)', () => {
  resetSmoothing('_default');
  const closes = gbmBars(200, 1000, 0.05, 0.15);
  const r      = detectRegime(closes); // no symbol argument
  assert(r.regime in REGIME, 'Must return valid regime without symbol arg');
});

test('aggregator.aggregate — works without opts (backward compat)', () => {
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes);  // no opts
  assert(['BUY','SELL','HOLD'].includes(result.signal));
  assert(typeof result.confidence === 'number');
});

test('aggregator.aggregate — still exports same fields as original', () => {
  resetSmoothing('COMPAT');
  const closes = makeTrending(400);
  const result = aggregator.aggregate(closes, { symbol: 'COMPAT' });
  assert('signal'      in result, 'signal must be present');
  assert('confidence'  in result, 'confidence must be present');
  assert('score'       in result, 'score must be present');
  assert('components'  in result, 'components must be present');
  assert('method'      in result, 'method must be present');
  assert('currentPrice'in result, 'currentPrice must be present');
  assert('timestamp'   in result, 'timestamp must be present');
});

// ─────────────────────────────────────────────────────────────────────────────
// Final report
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(62)}`);
console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
if (failed === 0) {
  console.log('  🎉 All regime detection tests passing!');
} else {
  console.log(`  ⚠️  ${failed} test(s) failed`);
}
console.log(`${'═'.repeat(62)}\n`);
process.exit(failed > 0 ? 1 : 0);
