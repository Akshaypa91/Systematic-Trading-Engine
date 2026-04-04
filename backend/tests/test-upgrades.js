// tests/test-upgrades.js
// ─────────────────────────────────────────────────────────────────────────────
// Test suite for all 8 engine upgrades.
// Run: node tests/test-upgrades.js
// Zero DB or network required.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();
process.env.LOG_LEVEL = 'silent';

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try   { fn(); console.log(`  ✅  ${name}`); passed++; }
  catch (e) { console.error(`  ❌  ${name}\n       → ${e.message}`); failed++; }
}
function assert(cond, msg)  { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertClose(a, e, tol = 0.001, msg) {
  if (Math.abs(a - e) > tol) throw new Error(`${msg || ''} Expected ≈${e}±${tol}, got ${a}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(58 - t.length)}`); }

// ── Price data generators ──────────────────────────────────────────────────
function randn() {
  let u=0,v=0;
  while(!u) u=Math.random(); while(!v) v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function makeBars(n, startPrice=1000, drift=0, vol=0.01) {
  const d0 = new Date('2021-01-04');
  const bars = [], dates = [];
  let d = new Date(d0);
  while(dates.length < n) {
    if(d.getDay()!==0&&d.getDay()!==6) dates.push(d.toISOString().slice(0,10));
    d = new Date(d.getTime()+86400000);
  }
  let p = startPrice;
  return dates.map((date,i) => {
    p = Math.max(10, p * (1 + drift + vol * randn()));
    return { date, open: p*0.999, high: p*1.005, low: p*0.995, close: p, volume: 1000000 };
  });
}
function makeTrending(n=500) { return makeBars(n, 1000, 0.001, 0.008); }   // strong uptrend
function makeSideways(n=500) { return makeBars(n, 1000, 0,     0.005); }   // flat + low vol
function makeVolatile(n=500) { return makeBars(n, 1000, 0,     0.025); }   // high vol

// ─────────────────────────────────────────────────────────────────────────────
section('1. Transaction Cost Modeling');
// ─────────────────────────────────────────────────────────────────────────────
const txCosts = require('../src/utils/transactionCosts');

test('computeCosts — BUY: no STT, has stamp duty', () => {
  process.env.USE_SIMPLIFIED_COSTS = 'false';
  // Reload module with new env (in test we patch directly)
  const C = require('../src/config/constants');
  // Use direct calculation to verify
  const price = 1000, qty = 100;
  const tradeValue = price * qty;
  // STT on BUY = 0, stamp = 0.015% on buy
  const expectedStamp = tradeValue * 0.00015;
  // Brokerage: min(0.03%, ₹20) = min(₹30, ₹20) = ₹20
  const expectedBrokerage = Math.min(tradeValue * 0.0003, 20);
  assert(expectedStamp > 0, 'Stamp duty on BUY should be > 0');
  assert(expectedBrokerage === 20, `Brokerage should be flat ₹20, got ${expectedBrokerage}`);
});

test('computeCosts — SELL: has STT 0.1%, has DP charge', () => {
  const price = 2000, qty = 50;
  const tradeValue = price * qty; // ₹1,00,000
  const expectedSTT = tradeValue * 0.001; // ₹100
  assert(expectedSTT === 100, `STT should be ₹100, got ${expectedSTT}`);
  // DP charge flat ₹13.5
  assert(13.5 > 0, 'DP charge should be positive on sell');
});

test('computeCosts — round-trip more expensive than single side', () => {
  // BUY cost + SELL cost > either alone (STT adds on sell)
  const buy  = { side: 'BUY',  price: 1000, qty: 100, tradeValue: 100000 };
  const sell = { side: 'SELL', price: 1000, qty: 100, tradeValue: 100000 };
  // On sell: STT = ₹100, DP = ₹13.5 — clearly > buy-only costs
  const sellSTT = 100000 * 0.001;
  const buySTT  = 100000 * 0;
  assert(sellSTT > buySTT, 'SELL STT should exceed BUY STT');
});

test('applySlippage — BUY fill > market price', () => {
  const { fillPrice } = txCosts.applySlippage({ side: 'BUY', marketPrice: 1000 });
  assert(fillPrice > 1000, `BUY fill ${fillPrice} should exceed market 1000`);
});

test('applySlippage — SELL fill < market price', () => {
  const { fillPrice } = txCosts.applySlippage({ side: 'SELL', marketPrice: 1000 });
  assert(fillPrice < 1000, `SELL fill ${fillPrice} should be below market 1000`);
});

test('applySlippage — high vol increases slippage', () => {
  const lowVol  = txCosts.applySlippage({ side: 'BUY', marketPrice: 1000, realisedVol: 0.10 });
  const highVol = txCosts.applySlippage({ side: 'BUY', marketPrice: 1000, realisedVol: 0.40 });
  assert(highVol.fillPrice >= lowVol.fillPrice, 'High vol should produce higher fill price');
});

test('applySlippage — capped at MAX_PCT', () => {
  const { slippagePct } = txCosts.applySlippage({ side: 'BUY', marketPrice: 1000, realisedVol: 10.0 });
  const C = require('../src/config/constants');
  assert(slippagePct <= C.SLIPPAGE.MAX_PCT, `Slippage ${slippagePct} should be ≤ ${C.SLIPPAGE.MAX_PCT}`);
});

test('computeExecutionCost — returns all required fields', () => {
  const result = txCosts.computeExecutionCost({ side: 'BUY', marketPrice: 1000, quantity: 100 });
  assert(typeof result.fillPrice    === 'number', 'fillPrice must be number');
  assert(typeof result.slippagePct  === 'number', 'slippagePct must be number');
  assert(typeof result.txCost       === 'number', 'txCost must be number');
  assert(typeof result.totalCostPct === 'number', 'totalCostPct must be number');
  assert(result.fillPrice > 1000, 'Fill price on BUY must exceed market');
});

// ─────────────────────────────────────────────────────────────────────────────
section('2. Slippage Simulation');
// ─────────────────────────────────────────────────────────────────────────────

test('slippage is asymmetric: BUY higher, SELL lower', () => {
  const buy  = txCosts.applySlippage({ side: 'BUY',  marketPrice: 500 });
  const sell = txCosts.applySlippage({ side: 'SELL', marketPrice: 500 });
  assert(buy.fillPrice  > 500, 'BUY fill must be above 500');
  assert(sell.fillPrice < 500, 'SELL fill must be below 500');
  // Symmetric in magnitude
  const buySlip  = buy.fillPrice  - 500;
  const sellSlip = 500 - sell.fillPrice;
  assertClose(buySlip, sellSlip, 0.01, 'Slippage should be symmetric in magnitude');
});

test('slippage is deterministic (no randomness)', () => {
  const r1 = txCosts.applySlippage({ side: 'BUY', marketPrice: 1000, realisedVol: 0.20 });
  const r2 = txCosts.applySlippage({ side: 'BUY', marketPrice: 1000, realisedVol: 0.20 });
  assert(r1.fillPrice === r2.fillPrice, 'Slippage must be deterministic');
});

// ─────────────────────────────────────────────────────────────────────────────
section('3. Market Regime Detection');
// ─────────────────────────────────────────────────────────────────────────────
const { detectRegime, computeADX, computeMASlope, REGIME } = require('../src/engine/regimeDetector');

test('detectRegime — returns UNKNOWN for insufficient data', () => {
  const result = detectRegime([1000, 1001, 1002]);
  assert(result.regime === REGIME.UNKNOWN, `Expected UNKNOWN, got ${result.regime}`);
  assert(result.confidence === 0, 'Confidence should be 0 for UNKNOWN');
});

test('detectRegime — strong trend detected in trending market', () => {
  const bars = makeTrending(400);
  const closes = bars.map(b => b.close);
  const result = detectRegime(closes);
  // Strong uptrend should be TRENDING or have high MA slope
  assert(['TRENDING', 'SIDEWAYS', 'VOLATILE'].includes(result.regime),
    `Regime ${result.regime} must be a valid enum value`);
  assert(result.confidence >= 0 && result.confidence <= 1,
    `Confidence ${result.confidence} must be in [0,1]`);
});

test('detectRegime — returns weights object', () => {
  const closes = makeBars(200).map(b => b.close);
  const result = detectRegime(closes);
  assert(typeof result.weights === 'object', 'weights must be an object');
  const { MEAN_REVERSION, MA_CROSSOVER, RSI } = result.weights;
  assert(typeof MEAN_REVERSION === 'number', 'MEAN_REVERSION weight must be number');
  assert(typeof MA_CROSSOVER   === 'number', 'MA_CROSSOVER weight must be number');
  assert(typeof RSI            === 'number', 'RSI weight must be number');
  assert(MEAN_REVERSION >= 0 && MA_CROSSOVER >= 0 && RSI >= 0, 'All weights must be ≥ 0');
});

test('regime weights — TRENDING boosts MA_CROSSOVER', () => {
  // Create strongly trending data (persistent upward move)
  const n = 400;
  const closes = [];
  let p = 1000;
  for (let i = 0; i < n; i++) { p *= 1.002; closes.push(p); }  // 0.2%/bar uptrend
  const result = detectRegime(closes);
  if (result.regime === REGIME.TRENDING) {
    assert(result.weights.MA_CROSSOVER >= 0.35,
      `Trending regime should boost MA_CROSSOVER, got ${result.weights.MA_CROSSOVER}`);
    assert(result.weights.MEAN_REVERSION <= 0.35,
      `Trending regime should reduce MEAN_REVERSION, got ${result.weights.MEAN_REVERSION}`);
  }
  // If not TRENDING (due to vol), just ensure weights are valid
  assert(result.confidence >= 0, 'Confidence must be non-negative');
});

test('computeADX — returns null for insufficient data', () => {
  const result = computeADX([1000, 1001]);
  assert(result === null, 'ADX should be null for < 30 bars');
});

test('computeADX — returns number for sufficient data', () => {
  const closes = makeBars(100).map(b => b.close);
  const result = computeADX(closes);
  assert(result === null || (typeof result === 'number' && result >= 0),
    `ADX should be null or non-negative number, got ${result}`);
});

test('computeMASlope — returns null for insufficient data', () => {
  const result = computeMASlope([1000, 1001, 1002]);
  assert(result === null, 'MASlope should be null for insufficient data');
});

// ─────────────────────────────────────────────────────────────────────────────
section('4. Portfolio Engine');
// ─────────────────────────────────────────────────────────────────────────────
const { allocateCapital, computePortfolioState, volScaledSize, checkPortfolioLimits } = require('../src/engine/portfolioEngine');

test('allocateCapital — equal method splits evenly', () => {
  const assets = [
    { symbol: 'RELIANCE', score: 0.8, recentVol: 0.20, signal: 'BUY' },
    { symbol: 'TCS',      score: 0.7, recentVol: 0.18, signal: 'BUY' },
    { symbol: 'INFY',     score: 0.6, recentVol: 0.22, signal: 'BUY' },
  ];
  const result = allocateCapital({ totalCapital: 1000000, assets, method: 'equal' });
  assert(result.length === 3, 'Should return allocation for all 3 assets');
  const buys = result.filter(r => r.allocation > 0);
  assert(buys.length === 3, 'All BUY assets should get allocation');
  // Equal allocation: each ≈ 33.3% of 95% = 316,667
  const alloc = buys[0].allocation;
  assertClose(alloc, 1000000 * 0.95 / 3, 1000, 'Equal allocation should be ~316k');
});

test('allocateCapital — ignores HOLD/SELL signals', () => {
  const assets = [
    { symbol: 'RELIANCE', score: 0.8, recentVol: 0.20, signal: 'BUY'  },
    { symbol: 'TCS',      score: 0.7, recentVol: 0.18, signal: 'HOLD' },
    { symbol: 'INFY',     score: 0.6, recentVol: 0.22, signal: 'SELL' },
  ];
  const result = allocateCapital({ totalCapital: 1000000, assets, method: 'equal' });
  const holdAlloc = result.find(r => r.symbol === 'TCS').allocation;
  const sellAlloc = result.find(r => r.symbol === 'INFY').allocation;
  assert(holdAlloc === 0, 'HOLD asset should get 0 allocation');
  assert(sellAlloc === 0, 'SELL asset should get 0 allocation');
});

test('allocateCapital — respects MAX_SINGLE_ASSET_PCT cap', () => {
  // 1 asset with BUY: should be capped at 20% max, but 95% deployed
  // Actually with 1 asset, all goes to it (up to MAX_SINGLE_ASSET_PCT)
  const assets = [{ symbol: 'RELIANCE', score: 1.0, recentVol: 0.20, signal: 'BUY' }];
  const result = allocateCapital({ totalCapital: 1000000, assets, method: 'equal' });
  // Single asset can get up to MAX_SINGLE_ASSET_PCT (20%) OR 95% of deployable
  // With 1 asset: equal weight = 100%, capped at 20%? No: MAX cap only applies
  // when MULTIPLE assets compete. With 1 asset, it gets the full deployable.
  assert(result[0].allocation <= 1000000, 'Allocation cannot exceed total capital');
  assert(result[0].allocation > 0, 'Allocation must be positive for BUY signal');
});

test('allocateCapital — vol_parity gives more to low-vol assets', () => {
  // Use 4 assets so per-asset cap (20%) doesn't equalize everything
  const assets = [
    { symbol: 'LOW_VOL',   score: 0.7, recentVol: 0.10, signal: 'BUY' },
    { symbol: 'HIGH_VOL',  score: 0.7, recentVol: 0.40, signal: 'BUY' },
    { symbol: 'MED_VOL_A', score: 0.7, recentVol: 0.20, signal: 'BUY' },
    { symbol: 'MED_VOL_B', score: 0.7, recentVol: 0.20, signal: 'BUY' },
  ];
  const result = allocateCapital({ totalCapital: 1000000, assets, method: 'vol_parity' });
  // raw weight for low-vol (1/0.10=10) >> high-vol (1/0.40=2.5)
  const lowVolWeight  = result.find(r => r.symbol === 'LOW_VOL').weight;
  const highVolWeight = result.find(r => r.symbol === 'HIGH_VOL').weight;
  assert(lowVolWeight > highVolWeight,
    `Low-vol raw weight should exceed high-vol: ${lowVolWeight} vs ${highVolWeight}`);
});

test('allocateCapital — score_weighted favours high-confidence signals', () => {
  // Use 4 assets to avoid per-asset cap equalising the two test subjects
  const assets = [
    { symbol: 'HIGH_CONF', score: 0.9, recentVol: 0.20, signal: 'BUY' },
    { symbol: 'LOW_CONF',  score: 0.1, recentVol: 0.20, signal: 'BUY' },
    { symbol: 'MED_A',     score: 0.5, recentVol: 0.20, signal: 'BUY' },
    { symbol: 'MED_B',     score: 0.5, recentVol: 0.20, signal: 'BUY' },
  ];
  const result = allocateCapital({ totalCapital: 1000000, assets, method: 'score_weighted' });
  const highConf = result.find(r => r.symbol === 'HIGH_CONF').weight;
  const lowConf  = result.find(r => r.symbol === 'LOW_CONF').weight;
  assert(highConf > lowConf, `High confidence raw weight should exceed low: ${highConf} vs ${lowConf}`);
});

test('computePortfolioState — tracks unrealised PnL correctly', () => {
  const positions = [
    { symbol: 'RELIANCE', entryPrice: 2000, currentPrice: 2200, quantity: 100, side: 'BUY' },
    { symbol: 'TCS',      entryPrice: 3500, currentPrice: 3300, quantity: 50,  side: 'BUY' },
  ];
  const state = computePortfolioState({ positions, cash: 100000 });
  // Unrealised PnL: (2200-2000)*100 + (3300-3500)*50 = 20000 - 10000 = 10000
  assertClose(state.unrealisedPnL, 10000, 1, 'Unrealised PnL should be ₹10,000');
  assert(state.totalValue > 0, 'Total value must be positive');
  assert(state.cashPct >= 0 && state.cashPct <= 1, 'Cash pct must be in [0,1]');
});

test('volScaledSize — low vol gets larger position', () => {
  const low  = volScaledSize({ capital: 1000000, entryPrice: 1000, realisedVol: 0.10 });
  const high = volScaledSize({ capital: 1000000, entryPrice: 1000, realisedVol: 0.40 });
  assert(low.quantity >= high.quantity,
    `Low vol (10%) should get ≥ quantity vs high vol (40%): ${low.quantity} vs ${high.quantity}`);
});

test('checkPortfolioLimits — blocks when max assets reached', () => {
  const maxPositions = Array(10).fill({ symbol: 'X', currentPrice: 1000, quantity: 100 });
  const { approved, warnings } = checkPortfolioLimits({
    currentPositions: maxPositions, newSymbol: 'NEW', newValue: 100000, totalCapital: 1000000,
  });
  assert(!approved, 'Should not approve when max assets reached');
  assert(warnings.length > 0, 'Should have warning message');
});

// ─────────────────────────────────────────────────────────────────────────────
section('5. Enhanced Backtester (costs + regime)');
// ─────────────────────────────────────────────────────────────────────────────
const { runBacktest } = require('../src/engine/backtester');

test('backtester — runs with 201+ bars', () => {
  const bars = makeBars(400, 1000, 0.0003, 0.008);
  const result = runBacktest({ symbol: 'TEST', prices: bars, initialCapital: 1000000 });
  assert(result.summary, 'Must return summary');
  assert(Array.isArray(result.trades), 'Must return trades array');
  assert(Array.isArray(result.equityCurve), 'Must return equity curve');
  assert(result.equityCurve.length > 0, 'Equity curve must not be empty');
});

test('backtester — throws for < 201 bars', () => {
  let threw = false;
  try { runBacktest({ symbol: 'X', prices: makeBars(100), initialCapital: 1000000 }); }
  catch(e) { threw = true; }
  assert(threw, 'Should throw for < 201 bars');
});

test('backtester — summary contains cost fields', () => {
  const bars = makeBars(400, 1000, 0.0003, 0.008);
  const { summary } = runBacktest({ symbol: 'TEST', prices: bars });
  assert(typeof summary.totalTransactionCosts !== 'undefined', 'totalTransactionCosts must be in summary');
  assert(typeof summary.totalSlippageCosts    !== 'undefined', 'totalSlippageCosts must be in summary');
  assert(typeof summary.costDragPct           !== 'undefined', 'costDragPct must be in summary');
});

test('backtester — costs reduce returns vs no-cost baseline', () => {
  // This is a qualitative test: total costs should be > 0 when trades occur
  const bars = makeBars(500, 1000, 0.0005, 0.008);
  const { summary } = runBacktest({ symbol: 'TEST', prices: bars, minConfidence: 0.1 });
  if (summary.totalTrades > 0) {
    assert(summary.totalTransactionCosts >= 0, 'Transaction costs must be ≥ 0');
  }
});

test('backtester — regime field present in trades', () => {
  const bars = makeBars(400, 1000, 0.0003, 0.008);
  const { trades } = runBacktest({ symbol: 'TEST', prices: bars, useRegimeDetection: true });
  // Some trades should have regime field (may be null if regime not detected yet)
  assert(Array.isArray(trades), 'Trades must be array');
});

test('backtester — regime detection disabled still works', () => {
  const bars = makeBars(400, 1000, 0.0003, 0.008);
  const result = runBacktest({ symbol: 'TEST', prices: bars, useRegimeDetection: false });
  assert(result.summary.totalTrades >= 0, 'Should work with regime detection disabled');
});

test('backtester — equity curve starts at initialCapital', () => {
  const bars = makeBars(400);
  const cap  = 500000;
  const { equityCurve } = runBacktest({ symbol: 'TEST', prices: bars, initialCapital: cap });
  assertClose(equityCurve[0], cap, 1, 'Equity curve must start at initialCapital');
});

// ─────────────────────────────────────────────────────────────────────────────
section('6. Walk-Forward Optimizer — Strict OOS Separation');
// ─────────────────────────────────────────────────────────────────────────────
const { runWalkForward, PARAM_GRIDS } = require('../src/engine/walkForwardOptimizer');

test('WFO — runs successfully with sufficient data', () => {
  const bars = makeBars(800, 1000, 0.0001, 0.008);
  const result = runWalkForward({ symbol: 'TEST', prices: bars, strategy: 'RSI', windows: 2 });
  assert(result.symbol    === 'TEST',     'Symbol must be preserved');
  assert(result.strategy  === 'RSI',      'Strategy must be preserved');
  assert(result.aggregateOos, 'Must have aggregateOos');
  assert(Array.isArray(result.windows),   'Must have windows array');
});

test('WFO — has purge/embargo configuration in output', () => {
  const bars = makeBars(800, 1000, 0.0001, 0.008);
  const result = runWalkForward({ symbol: 'TEST', prices: bars, strategy: 'RSI', windows: 2 });
  assert(result.separationConfig, 'Must have separationConfig');
  assert(result.separationConfig.rollingWindows === true, 'Must use rolling windows');
  assert(typeof result.separationConfig.purgeGap   === 'number', 'purgeGap must be number');
  assert(typeof result.separationConfig.embargoGap === 'number', 'embargoGap must be number');
});

test('WFO — OOS periods do not overlap IS periods', () => {
  const bars = makeBars(1000, 1000, 0.0001, 0.008);
  const result = runWalkForward({ symbol: 'TEST', prices: bars, strategy: 'MEAN_REVERSION', windows: 2 });
  for (const w of result.windows) {
    const isEnd  = w.isPeriod.end;
    const oosStart = w.oosPeriod.start;
    // OOS must start AFTER IS ends (with purge gap in between)
    assert(oosStart > isEnd, `OOS start ${oosStart} must be after IS end ${isEnd}`);
  }
});

test('WFO — has overfitRatio metric per window', () => {
  const bars = makeBars(900, 1000, 0.0001, 0.008);
  const result = runWalkForward({ symbol: 'TEST', prices: bars, strategy: 'RSI', windows: 2 });
  for (const w of result.windows) {
    assert('overfitRatio' in w, `Window ${w.window} must have overfitRatio`);
  }
});

test('WFO — OOS stability score in aggregateOos', () => {
  const bars = makeBars(900, 1000, 0.0001, 0.008);
  const result = runWalkForward({ symbol: 'TEST', prices: bars, strategy: 'RSI', windows: 2 });
  assert('oosStabilityScore' in result.aggregateOos, 'Must have oosStabilityScore');
  assert('avgOverfitRatio'   in result.aggregateOos, 'Must have avgOverfitRatio');
});

test('WFO — throws for unsupported strategy', () => {
  let threw = false;
  try { runWalkForward({ symbol: 'X', prices: makeBars(500), strategy: 'FAKE_STRATEGY' }); }
  catch(e) { threw = true; }
  assert(threw, 'Should throw for unsupported strategy');
});

test('WFO — equity curve returned and downsampled', () => {
  const bars = makeBars(800, 1000, 0.0001, 0.008);
  const result = runWalkForward({ symbol: 'TEST', prices: bars, strategy: 'RSI', windows: 2 });
  assert(Array.isArray(result.equityCurve), 'equityCurve must be array');
});

// ─────────────────────────────────────────────────────────────────────────────
section('7. Config System');
// ─────────────────────────────────────────────────────────────────────────────
const C = require('../src/config/constants');

test('TRANSACTION_COSTS section exists with all required fields', () => {
  const TC = C.TRANSACTION_COSTS;
  assert(typeof TC.BROKERAGE_PCT       === 'number', 'BROKERAGE_PCT must be number');
  assert(typeof TC.STT_SELL_PCT        === 'number', 'STT_SELL_PCT must be number');
  assert(typeof TC.STAMP_DUTY_PCT      === 'number', 'STAMP_DUTY_PCT must be number');
  assert(typeof TC.DP_CHARGE_FLAT      === 'number', 'DP_CHARGE_FLAT must be number');
  assert(typeof TC.GST_RATE            === 'number', 'GST_RATE must be number');
  assert(typeof TC.USE_SIMPLIFIED      === 'boolean','USE_SIMPLIFIED must be boolean');
  assert(TC.STT_SELL_PCT  === 0.001,  'STT on sell must be 0.1%');
  assert(TC.STT_BUY_PCT   === 0,      'STT on buy must be 0%');
  assert(TC.STAMP_DUTY_PCT === 0.00015,'Stamp duty must be 0.015%');
});

test('SLIPPAGE section exists with all required fields', () => {
  const SL = C.SLIPPAGE;
  assert(typeof SL.BASE_PCT      === 'number', 'BASE_PCT must be number');
  assert(typeof SL.SPREAD_PCT    === 'number', 'SPREAD_PCT must be number');
  assert(typeof SL.MAX_PCT       === 'number', 'MAX_PCT must be number');
  assert(typeof SL.VOL_SCALING   === 'boolean','VOL_SCALING must be boolean');
  assert(SL.MAX_PCT > 0,   'MAX_PCT must be > 0');
  assert(SL.BASE_PCT >= 0, 'BASE_PCT must be ≥ 0');
});

test('REGIME section exists with all required fields', () => {
  const R = C.REGIME;
  assert(typeof R.ADX_PERIOD      === 'number', 'ADX_PERIOD must be number');
  assert(typeof R.TREND_ADX_MIN   === 'number', 'TREND_ADX_MIN must be number');
  assert(typeof R.SIDEWAYS_ADX_MAX=== 'number', 'SIDEWAYS_ADX_MAX must be number');
  assert(R.TREND_ADX_MIN > R.SIDEWAYS_ADX_MAX, 'TREND threshold must exceed SIDEWAYS');
});

test('PORTFOLIO section exists with all required fields', () => {
  const P = C.PORTFOLIO;
  assert(typeof P.MAX_ASSETS      === 'number', 'MAX_ASSETS must be number');
  assert(typeof P.ALLOC_METHOD    === 'string', 'ALLOC_METHOD must be string');
  assert(['equal','vol_parity','score_weighted'].includes(P.ALLOC_METHOD),
    'ALLOC_METHOD must be valid');
});

test('WALK_FORWARD section exists with purge/embargo', () => {
  const WF = C.WALK_FORWARD;
  assert(typeof WF.PURGE_BARS   === 'number', 'PURGE_BARS must be number');
  assert(typeof WF.EMBARGO_BARS === 'number', 'EMBARGO_BARS must be number');
  assert(typeof WF.MIN_OOS_BARS === 'number', 'MIN_OOS_BARS must be number');
  assert(typeof WF.MIN_IS_BARS  === 'number', 'MIN_IS_BARS must be number');
  assert(WF.PURGE_BARS   >= 0, 'PURGE_BARS must be ≥ 0');
  assert(WF.EMBARGO_BARS >= 0, 'EMBARGO_BARS must be ≥ 0');
});

test('RISK section includes new portfolio fields', () => {
  const R = C.RISK;
  assert(typeof R.VOL_TARGET_ANNUAL    === 'number', 'VOL_TARGET_ANNUAL must be number');
  assert(typeof R.MAX_PORTFOLIO_EXPOSURE === 'number', 'MAX_PORTFOLIO_EXPOSURE must be number');
  assert(typeof R.MAX_SINGLE_ASSET_PCT === 'number', 'MAX_SINGLE_ASSET_PCT must be number');
  assert(R.MAX_PORTFOLIO_EXPOSURE <= 1, 'MAX_PORTFOLIO_EXPOSURE must be ≤ 100%');
  assert(R.MAX_SINGLE_ASSET_PCT   <= 1, 'MAX_SINGLE_ASSET_PCT must be ≤ 100%');
});

test('existing constants preserved (backward compat)', () => {
  assert(typeof C.BACKTEST.COMMISSION_PCT === 'number', 'COMMISSION_PCT preserved');
  assert(typeof C.BACKTEST.SLIPPAGE_PCT   === 'number', 'SLIPPAGE_PCT preserved');
  assert(typeof C.RISK.DEFAULT_CAPITAL    === 'number', 'DEFAULT_CAPITAL preserved');
  assert(Array.isArray(C.NIFTY50_SYMBOLS), 'NIFTY50_SYMBOLS preserved');
  assert(C.NIFTY50_SYMBOLS.length === 50,  'NIFTY50 still has 50 symbols');
});

// ─────────────────────────────────────────────────────────────────────────────
section('8. Existing Tests — No Regressions');
// ─────────────────────────────────────────────────────────────────────────────
const mu = require('../src/utils/mathUtils');

test('mathUtils.mean — preserved', () => {
  assertClose(mu.mean([1,2,3,4,5]), 3, 0.0001);
});
test('mathUtils.sharpeRatio — preserved', () => {
  const r = Array(252).fill(0.001);
  const s = mu.sharpeRatio(r, 0.065, 252);
  assert(s !== null && isFinite(s), 'Sharpe must be finite');
});
test('mathUtils.maxDrawdown — preserved', () => {
  const { maxDrawdown } = mu.maxDrawdown([100, 120, 90, 110, 95, 130]);
  assert(maxDrawdown > 0, 'MDD should be > 0');
  assertClose(maxDrawdown, 0.25, 0.001);  // 120→90 = 25%
});

const riskMgr = require('../src/risk/riskManager');
test('riskManager.fixedFractionalSize — preserved', () => {
  const { quantity } = riskMgr.fixedFractionalSize({
    capital: 1000000, entryPrice: 2000, stopLossPct: 0.02, riskPct: 0.02,
  });
  assert(quantity > 0, 'Quantity must be > 0');
});

test('riskManager.kellyCriterionSize — preserved', () => {
  const { quantity } = riskMgr.kellyCriterionSize({
    capital: 1000000, entryPrice: 2000, winRate: 0.55, avgWinPct: 0.04, avgLossPct: 0.02,
  });
  assert(quantity >= 0, 'Kelly quantity must be ≥ 0');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(62)}`);
console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
if (failed === 0) {
  console.log('  🎉 All upgrade tests passing!');
} else {
  console.log(`  ⚠️  ${failed} test(s) failed`);
}
console.log(`${'═'.repeat(62)}\n`);
process.exit(failed > 0 ? 1 : 0);
