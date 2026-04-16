// tests/test-signal-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for src/engine/signalEngine.js
// Run: node tests/test-signal-engine.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const se = require('../src/engine/signalEngine');

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function assertApprox(actual, expected, tol = 0.5, label = '') {
  const ok = Math.abs(actual - expected) <= tol;
  assert(ok, `${label} (got ${actual?.toFixed?.(4) ?? actual}, expected ~${expected})`);
}

// ── Price generators ──────────────────────────────────────────────────────────

/**
 * Flat prices — all same value. BB width = 0, SMA equal, RSI = 100.
 */
function flatPrices(n, price = 1000) {
  return Array(n).fill(price);
}

/**
 * Trending up prices — linear ramp.
 */
function trendingUp(n, start = 500, step = 5) {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

/**
 * Trending down prices — linear decline.
 */
function trendingDown(n, start = 1000, step = 5) {
  return Array.from({ length: n }, (_, i) => start - i * step);
}

/**
 * Oscillating prices — sine wave (mean-reverting).
 */
function oscillating(n, center = 1000, amplitude = 50) {
  return Array.from({ length: n }, (_, i) =>
    center + amplitude * Math.sin(2 * Math.PI * i / 20)
  );
}

/**
 * Prices that force RSI into oversold territory (series of down moves).
 */
function oversoldPrices(n = 60) {
  // Large drop at the end
  const prices = Array.from({ length: n - 15 }, (_, i) => 1000 + i * 2);
  for (let i = 0; i < 15; i++) prices.push(prices[prices.length - 1] * 0.92);
  return prices;
}

/**
 * Prices that force RSI into overbought (series of up moves).
 */
function overboughtPrices(n = 60) {
  const prices = Array.from({ length: n - 15 }, (_, i) => 1000 + i * 0.5);
  for (let i = 0; i < 15; i++) prices.push(prices[prices.length - 1] * 1.07);
  return prices;
}

// ── Step 1: calculateRSI ──────────────────────────────────────────────────────

console.log('\n── Step 1: calculateRSI ──────────────────────────────────────────');

{
  const r = se.calculateRSI(flatPrices(30));
  assert(r === 100, 'Flat prices (no changes) → RSI = 100');
}

{
  const r = se.calculateRSI(trendingUp(60));
  assert(r !== null && r > 70, `Strong uptrend → RSI overbought (${r?.toFixed(2)})`);
}

{
  const r = se.calculateRSI(trendingDown(60));
  assert(r !== null && r < 30, `Strong downtrend → RSI oversold (${r?.toFixed(2)})`);
}

{
  const r = se.calculateRSI([1, 2, 3]);  // < 15 bars
  assert(r === null, 'Insufficient data → null');
}

{
  // Oscillating should give RSI near 50
  const prices = oscillating(60);
  const r = se.calculateRSI(prices);
  assert(r !== null && r > 30 && r < 70, `Oscillating → RSI neutral range (${r?.toFixed(2)})`);
}

// ── Step 2: calculateMA ───────────────────────────────────────────────────────

console.log('\n── Step 2: calculateMA ───────────────────────────────────────────');

{
  const prices = [100, 200, 300, 400, 500];
  const ma = se.calculateMA(prices, 5);
  assertApprox(ma, 300, 0.01, 'SMA5 of [100..500]');
}

{
  const prices = trendingUp(60, 1000, 1);
  const sma20 = se.calculateMA(prices, 20);
  const sma50 = se.calculateMA(prices, 50);
  assert(sma20 > sma50, `Uptrend: SMA20 (${sma20?.toFixed(2)}) > SMA50 (${sma50?.toFixed(2)})`);
}

{
  const prices = trendingDown(60, 1000, 1);
  const sma20 = se.calculateMA(prices, 20);
  const sma50 = se.calculateMA(prices, 50);
  assert(sma20 < sma50, `Downtrend: SMA20 (${sma20?.toFixed(2)}) < SMA50 (${sma50?.toFixed(2)})`);
}

{
  assert(se.calculateMA([1, 2], 5) === null, 'Insufficient data → null');
}

// ── Step 3: calculateBB ───────────────────────────────────────────────────────

console.log('\n── Step 3: calculateBB ───────────────────────────────────────────');

{
  const prices = flatPrices(25, 1000);
  const bb = se.calculateBB(prices);
  assert(bb !== null, 'BB computes on flat prices');
  assert(bb.upper === bb.lower, 'Flat prices → zero bandwidth → upper === lower');
  assertApprox(bb.middle, 1000, 0.01, 'Middle band = 1000');
}

{
  const prices = oscillating(50, 1000, 100);
  const bb = se.calculateBB(prices);
  assert(bb !== null, 'BB computes on oscillating prices');
  assert(bb.upper > bb.middle && bb.middle > bb.lower, 'upper > middle > lower');
}

{
  assert(se.calculateBB([1, 2, 3]) === null, 'Insufficient data → null');
}

// ── Step 4: combineSignals ────────────────────────────────────────────────────

console.log('\n── Step 4: combineSignals ────────────────────────────────────────');

{
  // All three BUY votes
  const r = se.combineSignals({
    rsi: 25,             // oversold → +1
    sma20: 1100,
    sma50: 1000,         // sma20 > sma50 → +1
    bb: { upper: 1200, middle: 1050, lower: 1050 },
    currentPrice: 900,   // price < bbLower → +1
  });
  assert(r.signal === 'BUY', `All-BUY: score=${r.score} → signal=${r.signal}`);
  assert(r.score === 3, `All-BUY: score = 3 (got ${r.score})`);
  assert(r.components.rsi === 'oversold', 'components.rsi = oversold');
  assert(r.components.ma  === 'bullish',  'components.ma  = bullish');
  assert(r.components.bb  === 'lower_band', 'components.bb = lower_band');
}

{
  // All three SELL votes
  const r = se.combineSignals({
    rsi: 75,             // overbought → -1
    sma20: 900,
    sma50: 1000,         // sma20 < sma50 → -1
    bb: { upper: 1000, middle: 950, lower: 900 },
    currentPrice: 1100,  // price > bbUpper → -1
  });
  assert(r.signal === 'SELL', `All-SELL: score=${r.score} → signal=${r.signal}`);
  assert(r.score === -3, `All-SELL: score = -3 (got ${r.score})`);
}

{
  // Mixed: RSI neutral, MA bullish, BB inside bands → score = 1 → HOLD
  const r = se.combineSignals({
    rsi: 50,
    sma20: 1010, sma50: 1000,
    bb: { upper: 1100, middle: 1000, lower: 900 },
    currentPrice: 1010,
  });
  assert(r.signal === 'HOLD', `Score=1 → HOLD (score=${r.score})`);
  assert(r.score === 1, `Score correct (got ${r.score})`);
}

{
  // Score = 2 → BUY (threshold)
  const r = se.combineSignals({
    rsi: 25,             // +1
    sma20: 1010, sma50: 1000, // +1
    bb: { upper: 1100, middle: 1000, lower: 900 },
    currentPrice: 1010,  // inside bands → 0
  });
  assert(r.signal === 'BUY', `Score=2 → BUY (score=${r.score})`);
}

{
  // Score = -2 → SELL
  const r = se.combineSignals({
    rsi: 75,             // -1
    sma20: 990, sma50: 1000, // -1
    bb: { upper: 1100, middle: 1000, lower: 900 },
    currentPrice: 1010,  // inside → 0
  });
  assert(r.signal === 'SELL', `Score=-2 → SELL (score=${r.score})`);
}

{
  // Null indicators → HOLD with unavailable components
  const r = se.combineSignals({ rsi: null, sma20: null, sma50: null, bb: null, currentPrice: 1000 });
  assert(r.signal === 'HOLD', 'All-null indicators → HOLD');
  assert(r.score === 0, 'All-null → score 0');
}

// ── Step 5: computeSignal (full integration) ───────────────────────────────────

console.log('\n── Step 5: computeSignal (full integration) ──────────────────────');

{
  // Oversold scenario
  const prices = oversoldPrices(80);
  const sig = se.computeSignal('TESTBUY', prices);
  assert(sig.symbol === 'TESTBUY', 'symbol preserved');
  assert(sig.rsi !== null && sig.rsi < 40, `Oversold → RSI low (${sig.rsi})`);
  assert(['BUY', 'HOLD'].includes(sig.signal), `Oversold → BUY or HOLD (got ${sig.signal})`);
  assert(typeof sig.confidence === 'number', 'confidence is number');
  assert(sig.confidence >= 0 && sig.confidence <= 0.95, `confidence in [0, 0.95] (${sig.confidence})`);
  assert(sig.bbUpper !== null && sig.bbLower !== null, 'BB bands present');
  assert(sig.components && typeof sig.components === 'object', 'components object present');
  assert('rsi' in sig.components && 'ma' in sig.components && 'bb' in sig.components, 'all 3 components keys present');
}

{
  // Overbought scenario
  const prices = overboughtPrices(80);
  const sig = se.computeSignal('TESTSELL', prices);
  assert(sig.rsi !== null && sig.rsi > 60, `Overbought → RSI high (${sig.rsi})`);
  assert(['SELL', 'HOLD'].includes(sig.signal), `Overbought → SELL or HOLD (got ${sig.signal})`);
}

{
  // Insufficient data
  const sig = se.computeSignal('SHORT', [100, 200, 300]);
  assert(sig.signal === 'HOLD', 'Insufficient data → HOLD');
  assert(sig.error !== undefined, 'error field present when insufficient data');
}

{
  // Output shape matches required format
  const prices = trendingUp(100);
  const sig = se.computeSignal('SHAPE', prices);
  const requiredFields = ['symbol', 'signal', 'confidence', 'currentPrice', 'rsi', 'sma20', 'sma50', 'bbUpper', 'bbLower', 'components', 'timestamp'];
  for (const f of requiredFields) {
    assert(f in sig, `Output has field: ${f}`);
  }
  assert(['BUY', 'SELL', 'HOLD'].includes(sig.signal), `signal is valid enum: ${sig.signal}`);
  assert(typeof sig.timestamp === 'string', 'timestamp is ISO string');
}

// ── Step 6: Cache behaviour ────────────────────────────────────────────────────

console.log('\n── Step 6: Cache ─────────────────────────────────────────────────');

{
  const prices = trendingUp(100);
  const sig1 = se.computeSignal('CACHE_TEST', prices);
  const sig2 = se.getSignal('CACHE_TEST');  // from cache
  assert(sig2 !== null, 'Cache hit after computeSignal');
  assert(sig2.symbol === sig1.symbol, 'Cached signal symbol matches');

  se.clearCache('CACHE_TEST');
  const sig3 = se.getSignal('CACHE_TEST');
  assert(sig3 === null, 'After clearCache → null');
}

{
  se.clearCache();
  const all = se.getAllCachedSignals();
  assert(all.length === 0, 'clearCache() clears all entries');
}

// ── Step 7: computeSignalBatch ────────────────────────────────────────────────

console.log('\n── Step 7: computeSignalBatch ────────────────────────────────────');

{
  const batch = [
    { symbol: 'RELIANCE', prices: trendingUp(100, 2850, 2) },
    { symbol: 'INFY',     prices: oscillating(80, 1620, 50) },
    { symbol: 'TCS',      prices: trendingDown(100, 4200, 3) },
  ];
  const results = se.computeSignalBatch(batch);
  assert(results.length === 3, 'Batch returns 3 results');
  assert(results.every(r => ['BUY', 'SELL', 'HOLD'].includes(r.signal)), 'All signals valid');
  assert(results.every(r => r.symbol), 'All have symbols');
  console.log('  Batch signals:', results.map(r => `${r.symbol}: ${r.signal} (score ${r.score}, conf ${r.confidence})`).join(' | '));
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  Some tests failed!');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
}
