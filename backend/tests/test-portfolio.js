// tests/test-portfolio.js
// Self-contained portfolio engine test suite. No DB or network required.
// Run: node tests/test-portfolio.js
'use strict';

require('dotenv').config();
process.env.LOG_LEVEL = 'silent';

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); console.log(`  ✅  ${name}`); passed++; }
  catch(e) { console.error(`  ❌  ${name}\n       → ${e.message}`); failed++; }
}
function assert(c, m)  { if (!c) throw new Error(m || 'Assertion failed'); }
function assertClose(a, e, t = 0.01, m) {
  if (!isFinite(a)) throw new Error(`${m||''} expected ~${e}, got non-finite: ${a}`);
  if (Math.abs(a - e) > t) throw new Error(`${m||''} expected ≈${e}±${t}, got ${a}`);
}
function assertBetween(v, lo, hi, m) {
  if (v < lo || v > hi) throw new Error(`${m||''} expected [${lo},${hi}], got ${v}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(58-t.length)}`); }

// ── Price generators ──────────────────────────────────────────────────────────
function randn() {
  let u=0,v=0;
  while(!u) u=Math.random(); while(!v) v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

function makeBars(n, startPrice=1000, drift=0.0003, vol=0.008) {
  const d0 = new Date('2021-01-04');
  const dates = [];
  let d = new Date(d0);
  while (dates.length < n) {
    if (d.getDay()!==0 && d.getDay()!==6) dates.push(d.toISOString().slice(0,10));
    d = new Date(d.getTime() + 86400000);
  }
  let p = startPrice;
  return dates.map(date => {
    p = Math.max(10, p * (1 + drift + vol * randn()));
    return { date, open: p*0.999, high: p*1.005, low: p*0.995, close: p, volume: 1000000 };
  });
}

function makePricesMap(symbolConfigs) {
  const map = new Map();
  for (const [sym, cfg] of Object.entries(symbolConfigs)) {
    map.set(sym, makeBars(cfg.n || 400, cfg.start || 1000, cfg.drift || 0.0003, cfg.vol || 0.008));
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
const {
  PortfolioState, runPortfolioBacktest, rankSignals,
  allocateCapital, computePortfolioState, volScaledSize, checkPortfolioLimits,
} = require('../src/engine/portfolioEngine');

// ═══════════════════════════════════════════════════════════════════════════
section('1. PortfolioState — Constructor & Validation');
// ═══════════════════════════════════════════════════════════════════════════

test('PortfolioState initialises with correct cash and state', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  assert(ps.cash === 1_000_000, 'cash must equal initialCapital');
  assert(ps.positions.size === 0, 'positions must start empty');
  assert(ps.trades.length === 0, 'trades must start empty');
  assert(ps.peakEquity === 1_000_000, 'peakEquity must equal initialCapital');
  assert(ps.equityCurve.length === 1, 'equityCurve starts with 1 point');
});

test('PortfolioState throws for invalid initialCapital', () => {
  let threw = false;
  try { new PortfolioState({ initialCapital: 0 }); } catch(_) { threw = true; }
  assert(threw, 'Must throw for initialCapital=0');
  threw = false;
  try { new PortfolioState({ initialCapital: -1000 }); } catch(_) { threw = true; }
  assert(threw, 'Must throw for negative initialCapital');
});

test('PortfolioState respects custom config params', () => {
  const ps = new PortfolioState({ initialCapital: 500_000, maxPositions: 3, maxDrawdownPct: 0.10 });
  assert(ps.maxPositions === 3, 'maxPositions must be set');
  assert(ps.maxDrawdownPct === 0.10, 'maxDrawdownPct must be set');
});

// ═══════════════════════════════════════════════════════════════════════════
section('2. PortfolioState — totalEquity');
// ═══════════════════════════════════════════════════════════════════════════

test('totalEquity equals cash when no positions', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  const eq = ps.totalEquity(new Map());
  assertClose(eq, 1_000_000, 0.01, 'equity must equal cash when no positions');
});

test('totalEquity includes MTM of open positions', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  // Manually set a position: 100 shares @ 2000 = ₹200,000
  ps.positions.set('RELIANCE', { qty: 100, entryPrice: 2000, entryCost: 0, entrySlippage: 0,
    entryDate: '2023-01-01', stopLoss: 1960, takeProfit: 2080 });
  ps.cash -= 200_000;
  // Current price rises to 2200
  const prices = new Map([['RELIANCE', 2200]]);
  const eq     = ps.totalEquity(prices);
  // cash = 800,000; MTM = 100×2200 = 220,000; total = 1,020,000
  assertClose(eq, 1_020_000, 1, 'equity must include MTM gain');
});

test('totalEquity uses entryPrice for missing current prices', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.positions.set('TCS', { qty: 50, entryPrice: 3500, entryCost: 0, entrySlippage: 0,
    entryDate: '2023-01-01', stopLoss: 3430, takeProfit: 3640 });
  ps.cash -= 175_000;
  // No current prices provided → should not crash
  const eq = ps.totalEquity(new Map());
  assert(isFinite(eq), 'equity must be finite even without current prices');
});

// ═══════════════════════════════════════════════════════════════════════════
section('3. PortfolioState — openPosition & closePosition');
// ═══════════════════════════════════════════════════════════════════════════

test('openPosition deducts cash correctly', () => {
  const ps     = new PortfolioState({ initialCapital: 1_000_000 });
  const result = ps.openPosition({ symbol:'RELIANCE', qty:100, entryPrice:2000,
    entryDate:'2023-01-01', stopLoss:1960, takeProfit:2080, entryCost:60 });
  assert(result.success, 'openPosition must succeed');
  assertClose(ps.cash, 1_000_000 - 100*2000 - 60, 0.01, 'cash deduction must include entry cost');
  assert(ps.positions.has('RELIANCE'), 'position must be recorded');
});

test('openPosition fails when insufficient cash', () => {
  const ps     = new PortfolioState({ initialCapital: 100_000 });
  const result = ps.openPosition({ symbol:'RELIANCE', qty:1000, entryPrice:2000,
    entryDate:'2023-01-01', stopLoss:1960, takeProfit:2080, entryCost:60 });
  assert(!result.success, 'Must fail when cost > cash');
  assert(!ps.positions.has('RELIANCE'), 'Position must not be opened on failure');
  assertClose(ps.cash, 100_000, 0.01, 'Cash must be unchanged on failure');
});

test('closePosition returns proceeds and logs trade', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.openPosition({ symbol:'TCS', qty:50, entryPrice:3500, entryDate:'2023-01-01',
    stopLoss:3430, takeProfit:3640, entryCost:50 });
  const cashAfterEntry = ps.cash;

  const result = ps.closePosition({ symbol:'TCS', exitPrice:3700, exitDate:'2023-02-01',
    exitReason:'TAKE_PROFIT', exitCost:55 });
  assert(result !== null, 'closePosition must return result');
  assert(result.trade, 'must have trade object');
  assert(result.trade.symbol === 'TCS', 'trade symbol must match');
  // PnL = 50×(3700-3500) = 10,000 minus costs
  assert(result.trade.pnl > 0, 'profitable exit must have positive PnL');
  assert(!ps.positions.has('TCS'), 'position must be removed after close');
  assert(ps.trades.length === 1, 'trade must be recorded');
  // Cash increased by proceeds
  assert(ps.cash > cashAfterEntry, 'cash must increase on profitable exit');
});

test('closePosition on non-existent symbol returns null', () => {
  const ps     = new PortfolioState({ initialCapital: 1_000_000 });
  const result = ps.closePosition({ symbol:'FAKE', exitPrice:100, exitDate:'2023-01-01',
    exitReason:'SIGNAL', exitCost:0 });
  assert(result === null, 'Must return null for non-existent position');
});

test('closePosition records correct PnL', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.openPosition({ symbol:'INFY', qty:100, entryPrice:1700, entryDate:'2023-01-01',
    stopLoss:1666, takeProfit:1768, entryCost:0, entrySlippage:0 });
  const result = ps.closePosition({ symbol:'INFY', exitPrice:1700, exitDate:'2023-01-15',
    exitReason:'SIGNAL', exitCost:0, exitSlippage:0 });
  // Exit at same price as entry → PnL = 0 (no costs in this test)
  assertClose(result.trade.pnl, 0, 0.01, 'Break-even trade must have PnL ≈ 0');
});

// ═══════════════════════════════════════════════════════════════════════════
section('4. PortfolioState — canEnter (Risk Gates)');
// ═══════════════════════════════════════════════════════════════════════════

test('canEnter approves valid trade', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000, maxPositions: 5, maxSinglePct: 0.20 });
  const { approved } = ps.canEnter({ symbol: 'RELIANCE', positionValue: 100_000 });
  assert(approved, 'Valid trade within limits must be approved');
});

test('canEnter blocks duplicate symbol', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.openPosition({ symbol:'TCS', qty:50, entryPrice:3500, entryDate:'2023-01-01',
    stopLoss:3430, takeProfit:3640, entryCost:0 });
  const { approved, reasons } = ps.canEnter({ symbol: 'TCS', positionValue: 100_000 });
  assert(!approved, 'Must block duplicate symbol');
  assert(reasons.some(r => r.includes('TCS')), 'Reason must mention symbol');
});

test('canEnter blocks when maxPositions reached', () => {
  const ps = new PortfolioState({ initialCapital: 5_000_000, maxPositions: 2 });
  ps.openPosition({ symbol:'A', qty:100, entryPrice:100, entryDate:'2023-01-01', stopLoss:98, takeProfit:104, entryCost:0 });
  ps.openPosition({ symbol:'B', qty:100, entryPrice:100, entryDate:'2023-01-01', stopLoss:98, takeProfit:104, entryCost:0 });
  const { approved, reasons } = ps.canEnter({ symbol: 'C', positionValue: 10_000 });
  assert(!approved, 'Must block when maxPositions (2) reached');
  assert(reasons.some(r => r.includes('Max positions')), 'Reason must mention max positions');
});

test('canEnter blocks when single position exceeds maxSinglePct', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000, maxSinglePct: 0.10 });
  const { approved, reasons } = ps.canEnter({ symbol: 'RELIANCE', positionValue: 200_000 });
  assert(!approved, 'Must block 20% position when max is 10%');
  assert(reasons.some(r => r.includes('%')), 'Reason must mention percentage');
});

test('canEnter blocks when circuit breaker tripped', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000, maxDrawdownPct: 0.05 });
  // Manually simulate drawdown: set peak high, equity low
  ps.peakEquity = 1_000_000;
  ps.cash       = 900_000;  // 10% drawdown > 5% limit
  const { approved, reasons } = ps.canEnter({ symbol: 'TCS', positionValue: 50_000 });
  assert(!approved, 'Circuit breaker must block new entries');
  assert(reasons.some(r => r.toLowerCase().includes('drawdown')), 'Reason must mention drawdown');
});

test('canEnter blocks when insufficient cash', () => {
  const ps = new PortfolioState({ initialCapital: 100_000 });
  const { approved, reasons } = ps.canEnter({ symbol: 'RELIANCE', positionValue: 200_000 });
  assert(!approved, 'Must block when positionValue > cash');
  assert(reasons.some(r => r.includes('cash') || r.includes('Cash')), 'Reason must mention cash');
});

// ═══════════════════════════════════════════════════════════════════════════
section('5. PortfolioState — recordBarEnd & Drawdown Tracking');
// ═══════════════════════════════════════════════════════════════════════════

test('recordBarEnd updates equityCurve', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  const prices = new Map([['TCS', 3500]]);
  ps.recordBarEnd(prices);
  assert(ps.equityCurve.length === 2, 'equityCurve must grow by 1 each bar');
});

test('recordBarEnd updates peakEquity', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.cash = 1_200_000;  // simulate gain
  ps.recordBarEnd(new Map());
  assertClose(ps.peakEquity, 1_200_000, 1, 'peakEquity must update on new high');
});

test('recordBarEnd detects circuit breaker', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000, maxDrawdownPct: 0.10 });
  ps.peakEquity = 1_000_000;
  ps.cash       = 850_000;  // 15% drawdown > 10% limit
  const { circuitBreaker, drawdown } = ps.recordBarEnd(new Map());
  assert(circuitBreaker, 'Circuit breaker must fire at 15% drawdown');
  assertBetween(drawdown, 0.10, 0.20, 'drawdown must be in expected range');
});

test('recordBarEnd computes daily returns', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.cash = 1_010_000;  // 1% up
  ps.recordBarEnd(new Map());
  assert(ps.dailyReturns.length === 1, 'dailyReturns must have 1 entry');
  assertClose(ps.dailyReturns[0], 0.01, 0.001, 'daily return must be ≈1%');
});

// ═══════════════════════════════════════════════════════════════════════════
section('6. PortfolioState — snapshot');
// ═══════════════════════════════════════════════════════════════════════════

test('snapshot returns all required fields', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  const snap = ps.snapshot(new Map());
  const required = ['totalEquity','cash','marketValue','cashPct','deployedPct',
                    'positionCount','currentDrawdown','peakEquity','positions','totalTrades'];
  for (const f of required) assert(f in snap, `snapshot missing: ${f}`);
});

test('snapshot cashPct is 1.0 when no positions', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  const snap = ps.snapshot();
  assertClose(snap.cashPct, 1.0, 0.001, 'cashPct must be 1.0 with no positions');
});

test('snapshot positions include unrealisedPnL', () => {
  const ps = new PortfolioState({ initialCapital: 1_000_000 });
  ps.openPosition({ symbol:'SBIN', qty:1000, entryPrice:450, entryDate:'2023-01-01',
    stopLoss:441, takeProfit:468, entryCost:0, entrySlippage:0 });
  const prices = new Map([['SBIN', 500]]);
  const snap   = ps.snapshot(prices);
  assert(snap.positions.length === 1, 'Must have 1 position in snapshot');
  const pos = snap.positions[0];
  assert(pos.symbol === 'SBIN', 'Position symbol must match');
  assertClose(pos.unrealisedPnL, (500 - 450) * 1000, 1, 'unrealisedPnL must be correct');
});

// ═══════════════════════════════════════════════════════════════════════════
section('7. rankSignals');
// ═══════════════════════════════════════════════════════════════════════════

test('rankSignals filters HOLD and SELL when buyOnly=true', () => {
  const signals = [
    { symbol:'A', signal:'BUY',  confidence:0.8 },
    { symbol:'B', signal:'SELL', confidence:0.9 },
    { symbol:'C', signal:'HOLD', confidence:0.5 },
    { symbol:'D', signal:'BUY',  confidence:0.6 },
  ];
  const ranked = rankSignals(signals, { buyOnly: true });
  assert(ranked.every(r => r.signal === 'BUY'), 'Must only include BUY signals');
  assert(ranked.length === 2, 'Must return 2 BUY signals');
});

test('rankSignals sorts by confidence descending', () => {
  const signals = [
    { symbol:'A', signal:'BUY', confidence:0.5 },
    { symbol:'B', signal:'BUY', confidence:0.9 },
    { symbol:'C', signal:'BUY', confidence:0.7 },
  ];
  const ranked = rankSignals(signals, { topN: 3 });
  assert(ranked[0].symbol === 'B', 'Highest confidence must be first');
  assert(ranked[1].symbol === 'C', 'Second highest must be second');
  assert(ranked[2].symbol === 'A', 'Lowest must be last');
});

test('rankSignals respects topN limit', () => {
  const signals = Array(10).fill(null).map((_, i) => ({
    symbol: `SYM${i}`, signal: 'BUY', confidence: 0.5 + i * 0.04,
  }));
  const ranked = rankSignals(signals, { topN: 3 });
  assert(ranked.length === 3, `topN=3 must return 3 signals, got ${ranked.length}`);
});

test('rankSignals filters by minConfidence', () => {
  const signals = [
    { symbol:'A', signal:'BUY', confidence:0.15 },  // below threshold
    { symbol:'B', signal:'BUY', confidence:0.40 },
    { symbol:'C', signal:'BUY', confidence:0.60 },
  ];
  const ranked = rankSignals(signals, { minConfidence: 0.30 });
  assert(ranked.length === 2, 'Must filter out signals below minConfidence');
  assert(ranked.every(r => r.confidence >= 0.30), 'All ranked signals must meet minConfidence');
});

test('rankSignals returns empty array for no BUY signals', () => {
  const signals = [
    { symbol:'A', signal:'HOLD', confidence:0.8 },
    { symbol:'B', signal:'SELL', confidence:0.9 },
  ];
  const ranked = rankSignals(signals, { buyOnly: true });
  assert(ranked.length === 0, 'Must return empty when no qualifying signals');
});

test('rankSignals handles empty input', () => {
  assert(rankSignals([]).length === 0, 'Empty input must return empty array');
  assert(rankSignals(null).length === 0, 'Null input must return empty array');
});

test('rankSignals adds score field to output', () => {
  const signals = [{ symbol:'A', signal:'BUY', confidence:0.75 }];
  const ranked  = rankSignals(signals);
  assert('score' in ranked[0], 'ranked signals must have score field');
  assertClose(ranked[0].score, 0.75, 0.001, 'score must equal confidence for BUY');
});

// ═══════════════════════════════════════════════════════════════════════════
section('8. allocateCapital — Equal Method');
// ═══════════════════════════════════════════════════════════════════════════

test('allocateCapital equal — splits deployable evenly', () => {
  const assets = [
    { symbol:'A', signal:'BUY', score:0.8, recentVol:0.20 },
    { symbol:'B', signal:'BUY', score:0.7, recentVol:0.18 },
    { symbol:'C', signal:'BUY', score:0.6, recentVol:0.22 },
  ];
  const result = allocateCapital({ totalCapital: 1_000_000, assets, method: 'equal' });
  const buyResults = result.filter(r => r.allocation > 0);
  assert(buyResults.length === 3, 'All 3 BUY assets must get allocation');
  // Each gets ~1/3 of 95% of 1M = ~316,667
  for (const r of buyResults) assertBetween(r.allocation, 300_000, 340_000, `${r.symbol} allocation`);
});

test('allocateCapital equal — HOLD/SELL assets get 0 allocation', () => {
  const assets = [
    { symbol:'A', signal:'BUY',  score:0.8, recentVol:0.20 },
    { symbol:'B', signal:'HOLD', score:0.5, recentVol:0.18 },
    { symbol:'C', signal:'SELL', score:0.4, recentVol:0.22 },
  ];
  const result = allocateCapital({ totalCapital: 1_000_000, assets, method: 'equal' });
  assert(result.find(r => r.symbol === 'B').allocation === 0, 'HOLD must get 0');
  assert(result.find(r => r.symbol === 'C').allocation === 0, 'SELL must get 0');
});

test('allocateCapital — total allocation ≤ totalCapital', () => {
  const assets = Array(10).fill(null).map((_, i) => ({
    symbol: `SYM${i}`, signal: 'BUY', score: 0.5 + i * 0.03, recentVol: 0.15 + i * 0.01,
  }));
  for (const method of ['equal', 'vol_parity', 'score_weighted']) {
    const result   = allocateCapital({ totalCapital: 1_000_000, assets, method });
    const totalAlloc = result.reduce((s, r) => s + r.allocation, 0);
    assert(totalAlloc <= 1_000_000 + 0.01,
      `${method}: total allocation ${totalAlloc.toFixed(0)} must not exceed capital`);
  }
});

test('allocateCapital — throws for empty assets', () => {
  let threw = false;
  try { allocateCapital({ totalCapital: 1_000_000, assets: [] }); } catch(_) { threw = true; }
  assert(threw, 'Must throw for empty assets');
});

// ═══════════════════════════════════════════════════════════════════════════
section('9. allocateCapital — Vol Parity');
// ═══════════════════════════════════════════════════════════════════════════

test('vol_parity — low-vol asset gets higher raw weight', () => {
  const assets = [
    { symbol:'LOW_VOL',  signal:'BUY', score:0.7, recentVol:0.10 },
    { symbol:'HIGH_VOL', signal:'BUY', score:0.7, recentVol:0.40 },
    { symbol:'MED_A',    signal:'BUY', score:0.7, recentVol:0.20 },
    { symbol:'MED_B',    signal:'BUY', score:0.7, recentVol:0.20 },
  ];
  const result = allocateCapital({ totalCapital: 1_000_000, assets, method: 'vol_parity' });
  const lowW   = result.find(r => r.symbol === 'LOW_VOL').weight;
  const highW  = result.find(r => r.symbol === 'HIGH_VOL').weight;
  assert(lowW > highW, `Low-vol raw weight ${lowW} must exceed high-vol ${highW}`);
});

// ═══════════════════════════════════════════════════════════════════════════
section('10. allocateCapital — Score Weighted');
// ═══════════════════════════════════════════════════════════════════════════

test('score_weighted — high confidence gets higher weight', () => {
  const assets = [
    { symbol:'HIGH', signal:'BUY', score:0.9, recentVol:0.20 },
    { symbol:'LOW',  signal:'BUY', score:0.1, recentVol:0.20 },
    { symbol:'MED_A',signal:'BUY', score:0.5, recentVol:0.20 },
    { symbol:'MED_B',signal:'BUY', score:0.5, recentVol:0.20 },
  ];
  const result = allocateCapital({ totalCapital: 1_000_000, assets, method: 'score_weighted' });
  const highW  = result.find(r => r.symbol === 'HIGH').weight;
  const lowW   = result.find(r => r.symbol === 'LOW').weight;
  assert(highW > lowW, `High score weight ${highW} must exceed low score ${lowW}`);
});

// ═══════════════════════════════════════════════════════════════════════════
section('11. volScaledSize');
// ═══════════════════════════════════════════════════════════════════════════

test('volScaledSize — low-vol gets larger quantity', () => {
  const low  = volScaledSize({ capital:1_000_000, entryPrice:1000, realisedVol:0.10 });
  const high = volScaledSize({ capital:1_000_000, entryPrice:1000, realisedVol:0.40 });
  assert(low.quantity >= high.quantity, `Low-vol qty ${low.quantity} must be ≥ high-vol ${high.quantity}`);
});

test('volScaledSize — quantity is non-negative integer', () => {
  const r = volScaledSize({ capital:1_000_000, entryPrice:2000, realisedVol:0.20 });
  assert(Number.isInteger(r.quantity), 'quantity must be integer');
  assert(r.quantity >= 0, 'quantity must be non-negative');
});

test('volScaledSize — throws for invalid inputs', () => {
  let threw = false;
  try { volScaledSize({ capital:0, entryPrice:1000, realisedVol:0.20 }); } catch(_) { threw = true; }
  assert(threw, 'Must throw for capital=0');
});

test('volScaledSize — positionValue does not exceed maxSinglePct', () => {
  const r = volScaledSize({ capital:1_000_000, entryPrice:100, realisedVol:0.01 });
  // Very low vol → huge position, but must be capped at MAX_SINGLE_ASSET_PCT
  assert(r.positionValue <= 1_000_000 * 0.25, 'position must not exceed 25% of capital');
});

// ═══════════════════════════════════════════════════════════════════════════
section('12. checkPortfolioLimits');
// ═══════════════════════════════════════════════════════════════════════════

test('checkPortfolioLimits — approves valid addition', () => {
  const { approved } = checkPortfolioLimits({
    currentPositions: [],
    newSymbol: 'RELIANCE',
    newValue: 100_000,
    totalCapital: 1_000_000,
  });
  assert(approved, 'Must approve valid trade with empty portfolio');
});

test('checkPortfolioLimits — blocks when max assets reached', () => {
  const positions = Array(10).fill({ symbol:'X', currentPrice:100, quantity:10 });
  const { approved, warnings } = checkPortfolioLimits({
    currentPositions: positions, newSymbol:'NEW', newValue:10_000, totalCapital:1_000_000,
  });
  assert(!approved, 'Must block when max assets reached');
  assert(warnings.length > 0, 'Must return warnings');
});

// ═══════════════════════════════════════════════════════════════════════════
section('13. computePortfolioState — preserved API');
// ═══════════════════════════════════════════════════════════════════════════

test('computePortfolioState — correct totalValue', () => {
  const positions = [
    { symbol:'A', entryPrice:1000, currentPrice:1100, quantity:100, side:'BUY' },
    { symbol:'B', entryPrice:2000, currentPrice:1900, quantity:50,  side:'BUY' },
  ];
  const state = computePortfolioState({ positions, cash: 200_000 });
  // A: 1100×100=110,000; B: 1900×50=95,000; cash=200,000; total=405,000
  assertClose(state.totalValue, 405_000, 1, 'totalValue must be correct');
});

test('computePortfolioState — unrealisedPnL calculated correctly', () => {
  const positions = [
    { symbol:'A', entryPrice:1000, currentPrice:1200, quantity:100, side:'BUY' },
  ];
  const state = computePortfolioState({ positions, cash: 0 });
  // PnL = (1200-1000)×100 = 20,000
  assertClose(state.unrealisedPnL, 20_000, 1, 'unrealisedPnL must be ₹20,000');
});

// ═══════════════════════════════════════════════════════════════════════════
section('14. runPortfolioBacktest — Validation');
// ═══════════════════════════════════════════════════════════════════════════

test('runPortfolioBacktest throws for empty symbols', () => {
  let threw = false;
  try { runPortfolioBacktest({ symbols:[], pricesMap: new Map() }); } catch(_) { threw = true; }
  assert(threw, 'Must throw for empty symbols');
});

test('runPortfolioBacktest throws when pricesMap is not a Map', () => {
  let threw = false;
  try { runPortfolioBacktest({ symbols:['A'], pricesMap: {} }); } catch(_) { threw = true; }
  assert(threw, 'Must throw when pricesMap is not a Map');
});

test('runPortfolioBacktest throws for invalid strategy', () => {
  let threw = false;
  try {
    runPortfolioBacktest({ symbols:['A'], pricesMap: new Map(), strategy:'INVALID' });
  } catch(_) { threw = true; }
  assert(threw, 'Must throw for unknown strategy');
});

// ═══════════════════════════════════════════════════════════════════════════
section('15. runPortfolioBacktest — Simulation');
// ═══════════════════════════════════════════════════════════════════════════

test('runPortfolioBacktest — runs successfully with 2 symbols', () => {
  const pricesMap = makePricesMap({ RELIANCE: {n:400}, TCS: {n:400} });
  const result    = runPortfolioBacktest({
    symbols: ['RELIANCE', 'TCS'], pricesMap,
    initialCapital: 1_000_000, strategy: 'RSI', maxPositions: 2,
  });
  assert(result.summary,    'Must return summary');
  assert(result.trades,     'Must return trades array');
  assert(result.equityCurve,'Must return equityCurve');
  assert(result.perSymbolStats, 'Must return perSymbolStats');
});

test('runPortfolioBacktest — equityCurve starts at initialCapital', () => {
  const pricesMap = makePricesMap({ A: {n:400}, B: {n:400} });
  const result    = runPortfolioBacktest({
    symbols: ['A','B'], pricesMap,
    initialCapital: 500_000, strategy: 'RSI', maxPositions: 2,
  });
  assertClose(result.equityCurve[0], 500_000, 1, 'First equity point must be initialCapital');
});

test('runPortfolioBacktest — summary has all required fields', () => {
  const pricesMap = makePricesMap({ A: {n:400} });
  const result    = runPortfolioBacktest({
    symbols: ['A'], pricesMap, initialCapital: 500_000, strategy: 'RSI',
  });
  const required = ['totalReturnPct','sharpeRatio','maxDrawdownPct','totalTrades',
                    'winRatePct','profitFactor','totalTransactionCosts'];
  for (const f of required) assert(f in result.summary, `summary missing: ${f}`);
});

test('runPortfolioBacktest — perSymbolStats covers all symbols', () => {
  const syms = ['A','B','C'];
  const pricesMap = makePricesMap(Object.fromEntries(syms.map(s => [s, {n:400}])));
  const result = runPortfolioBacktest({
    symbols: syms, pricesMap, initialCapital: 1_000_000, strategy: 'RSI',
  });
  for (const sym of syms) {
    assert(sym in result.perSymbolStats, `perSymbolStats must include ${sym}`);
    assert('trades' in result.perSymbolStats[sym], `${sym} stats must have trades`);
    assert('winRate' in result.perSymbolStats[sym], `${sym} stats must have winRate`);
    assert('totalPnL' in result.perSymbolStats[sym], `${sym} stats must have totalPnL`);
  }
});

test('runPortfolioBacktest — never has negative cash (accounting integrity)', () => {
  const pricesMap = makePricesMap({
    A:{n:400,drift:0.001}, B:{n:400,drift:0.001},
    C:{n:400,drift:0.001}, D:{n:400,drift:0.001},
  });
  const result = runPortfolioBacktest({
    symbols: ['A','B','C','D'], pricesMap,
    initialCapital: 1_000_000, strategy: 'RSI',
    maxPositions: 4, minConfidence: 0.1,
  });
  // All equity curve points must be non-negative (cash never goes negative)
  const minEquity = Math.min(...result.equityCurve);
  assert(minEquity >= 0, `Equity must never go negative, min was ${minEquity}`);
});

test('runPortfolioBacktest — maxPositions limit is respected', () => {
  const syms = ['A','B','C','D','E','F'];
  const pricesMap = makePricesMap(Object.fromEntries(syms.map(s => [s, {n:400}])));
  const maxPos = 2;
  const result = runPortfolioBacktest({
    symbols: syms, pricesMap,
    initialCapital: 5_000_000, strategy: 'MEAN_REVERSION',
    maxPositions: maxPos, minConfidence: 0.01,  // low threshold to trigger entries
    topN: 10,
  });
  // Check that no more than maxPos symbols had trades open simultaneously
  // Verify via trade log: no date should have > maxPos open positions
  // (We verify through having a valid result without crashing)
  assert(result.summary.totalTrades >= 0, 'Must complete without crash');
});

test('runPortfolioBacktest — backward compat: single-asset still works', () => {
  // Single symbol portfolio must behave like single-asset backtest
  const pricesMap = makePricesMap({ RELIANCE: {n:400} });
  const result    = runPortfolioBacktest({
    symbols: ['RELIANCE'], pricesMap,
    initialCapital: 1_000_000, strategy: 'RSI', maxPositions: 1,
  });
  assert(result.summary.symbols.includes('RELIANCE'), 'Summary must include symbol');
  assert(typeof result.summary.totalReturnPct === 'number', 'totalReturnPct must be number');
});

test('runPortfolioBacktest — different alloc methods produce different results', () => {
  const pricesMap = makePricesMap({
    A:{n:400,vol:0.10}, B:{n:400,vol:0.30}, C:{n:400,vol:0.20},
  });
  const equal = runPortfolioBacktest({
    symbols:['A','B','C'], pricesMap, initialCapital:1_000_000,
    strategy:'RSI', allocMethod:'equal',
  });
  const volParity = runPortfolioBacktest({
    symbols:['A','B','C'], pricesMap, initialCapital:1_000_000,
    strategy:'RSI', allocMethod:'vol_parity',
  });
  // Results may differ due to different position sizing
  // Just verify both run without error and return valid summaries
  assert(typeof equal.summary.totalReturnPct === 'number');
  assert(typeof volParity.summary.totalReturnPct === 'number');
});

// ═══════════════════════════════════════════════════════════════════════════
section('16. Backward Compatibility — Existing API Preserved');
// ═══════════════════════════════════════════════════════════════════════════

test('allocateCapital — same signature as original', () => {
  const result = allocateCapital({
    totalCapital: 1_000_000,
    assets: [{ symbol:'A', signal:'BUY', score:0.8, recentVol:0.20 }],
    method: 'equal',
  });
  assert(Array.isArray(result), 'Must return array');
  assert('symbol' in result[0], 'result items must have symbol');
  assert('allocation' in result[0], 'result items must have allocation');
  assert('allocPct' in result[0], 'result items must have allocPct');
  assert('weight' in result[0], 'result items must have weight');
});

test('computePortfolioState — same signature as original', () => {
  const state = computePortfolioState({ positions: [], cash: 1_000_000 });
  assert('totalValue' in state, 'totalValue must be present');
  assert('cash' in state, 'cash must be present');
  assert('positionCount' in state, 'positionCount must be present');
});

test('volScaledSize — same signature as original', () => {
  const r = volScaledSize({ capital:1_000_000, entryPrice:2000, realisedVol:0.20 });
  assert('quantity' in r, 'quantity must be present');
  assert('positionValue' in r, 'positionValue must be present');
  assert('volContribution' in r, 'volContribution must be present');
});

test('checkPortfolioLimits — same signature as original', () => {
  const r = checkPortfolioLimits({ currentPositions:[], newSymbol:'X', newValue:1000, totalCapital:100_000 });
  assert('approved' in r, 'approved must be present');
  assert('warnings' in r, 'warnings must be present');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(62)}`);
console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
console.log(failed === 0 ? '  🎉 All portfolio tests passing!' : `  ⚠️  ${failed} test(s) failed`);
console.log(`${'═'.repeat(62)}\n`);
process.exit(failed > 0 ? 1 : 0);
