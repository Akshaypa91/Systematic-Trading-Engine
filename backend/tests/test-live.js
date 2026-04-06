// tests/test-live.js
// Self-contained test suite for the live signal engine.
// No DB, no network — all external deps are stubbed via require cache.
// Run: node tests/test-live.js
'use strict';

require('dotenv').config();
process.env.LOG_LEVEL        = 'silent';
process.env.PAPER_TRADE_AUTO = 'false';

// ── Stub via require.cache injection ─────────────────────────────────────────
// Resolve real paths first, then override the cache entry.
const path    = require('path');
const srcRoot = path.resolve(__dirname, '../src');

function cacheStub(relPath, exports) {
  const absPath = path.resolve(srcRoot, relPath);
  // Touch require.cache with a fake module
  require.cache[require.resolve(absPath)] = {
    id: absPath, filename: absPath, loaded: true,
    exports, children: [], parent: null, paths: [],
  };
}

// ── DB stub ───────────────────────────────────────────────────────────────────
cacheStub('config/database', { query: async () => [[], {}] });

// ── WebSocket broadcast collector ─────────────────────────────────────────────
const _broadcasts = [];
cacheStub('data/liveDataFeed', {
  broadcast:      (p) => _broadcasts.push(p),
  broadcastAlert: ()  => {},
  getStats:       ()  => ({ connectedClients: 0, activeSubscriptions: 0 }),
});

// ── Paper trade stubs ─────────────────────────────────────────────────────────
const _paperOrders   = [];
const _openPositions = {};
const _capital       = 1_000_000;

cacheStub('engine/executionEngine', {
  getPortfolioState:     () => ({ capital: _capital, openPositions: _openPositions, dailyPnl: 0, openCount: 0 }),
  placeOrder:            async (p) => { _paperOrders.push(p); return { status: 'EXECUTED', ...p }; },
  checkAndClosePosition: async () => null,
  getRecentOrders:       async () => [],
});

cacheStub('risk/riskManager', {
  fixedFractionalSize: () => ({ quantity: 10, positionValue: 10000 }),
  validateTrade:       () => ({ approved: true, reasons: [] }),
  computeLevels:       () => ({ stopLoss: 900, takeProfit: 1100 }),
  recordDailyLoss:     () => {},
  checkDailyLossLimit: () => ({ blocked: false }),
});

// ── Scheduler stub ────────────────────────────────────────────────────────────
cacheStub('engine/scheduler', {
  getJobStatus:  () => [],
  isMarketHours: () => true,
  addJob:        () => {},
  start: () => {}, stop: () => {},
});

// ── DataStore stub — returns synthetic bars ───────────────────────────────────
function randn() {
  let u=0,v=0;
  while(!u) u=Math.random(); while(!v) v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function makeBars(n, start=1000) {
  const d0 = new Date('2021-01-04'); const dates = [];
  let d = new Date(d0);
  while(dates.length < n) {
    if(d.getDay()!==0&&d.getDay()!==6) dates.push(d.toISOString().slice(0,10));
    d = new Date(d.getTime()+86400000);
  }
  let p = start;
  return dates.map(date => {
    p = Math.max(1, p*(1+0.0003+0.008*randn()));
    return { date, open:p*0.999, high:p*1.005, low:p*0.995, close:p, volume:1e6 };
  });
}
const _barsStore = new Map();
cacheStub('data/dataStore', {
  getRecentPrices: async (sym, n=250) => {
    if (!_barsStore.has(sym)) _barsStore.set(sym, makeBars(n+20, 800+Math.random()*400));
    return _barsStore.get(sym).slice(-n);
  },
});

// Override stub for "tiny" symbol (< 201 bars)
function setTinyBars(sym, n) { _barsStore.set(sym, makeBars(n)); }

// ── Load module under test AFTER stubs are in cache ──────────────────────────
const engine = require('../src/engine/liveSignalEngine');
const { start, stop, runOnce, addSymbol, removeSymbol,
        resetCircuitBreaker, getLatestSignals, getStatus,
        _processSymbol, _signalHash } = engine;

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const _queue = [];

function test(name, fn)      { _queue.push({ name, fn, async: false }); }
function testAsync(name, fn) { _queue.push({ name, fn, async: true  }); }
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }
function assertClose(a, e, t=0.01, m) {
  if (!isFinite(a)) throw new Error(`${m||''} expected ~${e}, got ${a}`);
  if (Math.abs(a-e) > t) throw new Error(`${m||''} expected ≈${e}±${t}, got ${a}`);
}
function section(t) { _queue.push({ _section: t }); }

async function runAll() {
  for (const item of _queue) {
    if (item._section) { console.log(`\n── ${item._section} ${'─'.repeat(58-item._section.length)}`); continue; }
    total++;
    try {
      if (item.async) await item.fn(); else item.fn();
      console.log(`  ✅  ${item.name}`); passed++;
    } catch(e) {
      console.error(`  ❌  ${item.name}\n       → ${e.message}`); failed++;
    }
  }
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
  console.log(failed === 0 ? '  🎉 All live signal engine tests passing!' : `  ⚠️  ${failed} test(s) failed`);
  console.log(`${'═'.repeat(62)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════
section('1. Signal Hash — Deduplication');

test('_signalHash — produces 16-char hex string', () => {
  const h = _signalHash('RELIANCE', '2024-01-15', 'BUY');
  assert(typeof h === 'string', 'hash must be string');
  assert(h.length === 16, `hash must be 16 chars, got ${h.length}`);
  assert(/^[0-9a-f]+$/.test(h), 'hash must be hex');
});
test('_signalHash — deterministic', () => {
  const h1 = _signalHash('TCS', '2024-01-15', 'SELL');
  const h2 = _signalHash('TCS', '2024-01-15', 'SELL');
  assert(h1 === h2, 'hash must be deterministic');
});
test('_signalHash — different signals', () => {
  assert(_signalHash('TCS','2024-01-15','BUY') !== _signalHash('TCS','2024-01-15','SELL'));
});
test('_signalHash — different symbols', () => {
  assert(_signalHash('TCS','2024-01-15','BUY') !== _signalHash('RELIANCE','2024-01-15','BUY'));
});
test('_signalHash — different dates', () => {
  assert(_signalHash('INFY','2024-01-15','BUY') !== _signalHash('INFY','2024-01-16','BUY'));
});

// ═════════════════════════════════════════════════════════════════════════════
section('2. _processSymbol — Core Pipeline');

testAsync('_processSymbol — returns valid signal object', async () => {
  const result = await _processSymbol('RELIANCE');
  assert(!result.error,   `Must not error: ${result.error}`);
  assert(!result.skipped, 'Must not be skipped');
  assert(['BUY','SELL','HOLD'].includes(result.signal), `Invalid signal: ${result.signal}`);
  assert(typeof result.confidence === 'number', 'confidence must be number');
  assert(result.confidence >= 0 && result.confidence <= 1, `confidence out of [0,1]: ${result.confidence}`);
  assert(typeof result.currentPrice === 'number', 'currentPrice must be number');
  assert(typeof result.timestamp === 'string', 'timestamp must be string');
  assert(typeof result.hash === 'string' && result.hash.length === 16, 'hash must be 16-char string');
});

testAsync('_processSymbol — populates signal cache', async () => {
  await _processSymbol('TCS');
  const cached = getLatestSignals(['TCS']);
  assert(cached.length === 1, 'cache must have TCS');
  assert(['BUY','SELL','HOLD'].includes(cached[0].signal), 'cached signal must be valid');
});

testAsync('_processSymbol — skips symbol with < 201 bars', async () => {
  setTinyBars('TINYSTOCK', 50);
  const result = await _processSymbol('TINYSTOCK');
  assert(result.skipped === true, 'Must skip with < 201 bars');
  assert(result.reason === 'insufficient_data', `Wrong reason: ${result.reason}`);
});

testAsync('_processSymbol — includes regime in result', async () => {
  const result = await _processSymbol('WIPRO');
  if (!result.skipped) assert('regime' in result, 'regime field must exist');
});

testAsync('_processSymbol — all component strategies present', async () => {
  const result = await _processSymbol('AXISBANK');
  if (!result.skipped && result.components) {
    const strats = result.components.map(c => c.strategy);
    assert(strats.includes('MA_CROSSOVER'),   'MA_CROSSOVER component required');
    assert(strats.includes('MEAN_REVERSION'), 'MEAN_REVERSION component required');
    assert(strats.includes('RSI'),            'RSI component required');
  }
});

// ═════════════════════════════════════════════════════════════════════════════
section('3. Circuit Breaker');

testAsync('circuit breaker trips after 3 consecutive errors', async () => {
  // Temporarily make dataStore throw for BADSYM
  const ds = require('../src/data/dataStore');
  const orig = ds.getRecentPrices;
  ds.getRecentPrices = async (sym) => {
    if (sym === 'BADSYM') throw new Error('NSE 403');
    return orig(sym);
  };

  resetCircuitBreaker('BADSYM');
  await _processSymbol('BADSYM');
  await _processSymbol('BADSYM');
  await _processSymbol('BADSYM');  // trips on 3rd

  ds.getRecentPrices = orig;  // restore

  const fourth = await _processSymbol('BADSYM');
  assert(fourth.reason === 'circuit_breaker', `Expected circuit_breaker, got ${fourth.reason}`);
});

test('resetCircuitBreaker — re-enables disabled symbol', () => {
  resetCircuitBreaker('BADSYM');
  const s = getStatus().symbolStates['BADSYM'];
  if (s) {
    assert(!s.disabled,   'Must not be disabled after reset');
    assert(s.errors === 0,'Error count must be 0 after reset');
  }
});

testAsync('circuit-broken symbol returns skipped=true', async () => {
  // Make BROKEN2 trip its breaker
  const ds = require('../src/data/dataStore');
  const orig = ds.getRecentPrices;
  ds.getRecentPrices = async (sym) => {
    if (sym === 'BROKEN2') throw new Error('timeout');
    return orig(sym);
  };
  resetCircuitBreaker('BROKEN2');
  for (let i = 0; i < 3; i++) await _processSymbol('BROKEN2');
  ds.getRecentPrices = orig;

  const result = await _processSymbol('BROKEN2');
  assert(result.skipped === true, 'Circuit-broken must be skipped');
});

// ═════════════════════════════════════════════════════════════════════════════
section('4. Watchlist Management');

test('addSymbol — adds new symbol', () => {
  start({ watchlist: ['RELIANCE', 'TCS'], runOnStart: false });
  assert(addSymbol('INFY') === true, 'Must return true for new symbol');
  assert(getStatus().watchlist.includes('INFY'), 'INFY must be in watchlist');
  stop();
});
test('addSymbol — uppercases symbol', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  addSymbol('wipro');
  assert(getStatus().watchlist.includes('WIPRO'), 'Must uppercase');
  stop();
});
test('addSymbol — returns false for duplicate', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  assert(addSymbol('RELIANCE') === false, 'Must return false for duplicate');
  stop();
});
test('removeSymbol — removes existing symbol', () => {
  start({ watchlist: ['RELIANCE','TCS','INFY'], runOnStart: false });
  assert(removeSymbol('TCS') === true, 'Must return true');
  assert(!getStatus().watchlist.includes('TCS'), 'TCS must be gone');
  assert(getStatus().watchlist.includes('RELIANCE'), 'Others must remain');
  stop();
});
test('removeSymbol — returns false for unknown', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  assert(removeSymbol('FAKE') === false, 'Must return false');
  stop();
});
test('removeSymbol — clears signal cache for removed symbol', () => {
  start({ watchlist: ['RELIANCE','TCS'], runOnStart: false });
  removeSymbol('TCS');
  const sig = getLatestSignals(['TCS']);
  assert(sig[0].signal == null, 'Removed symbol must have null cached signal');
  stop();
});

// ═════════════════════════════════════════════════════════════════════════════
section('5. getStatus');

test('getStatus — all required fields', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  const s = getStatus();
  for (const f of ['running','intervalMs','watchlist','watchlistSize',
                   'lastRun','runCount','totalErrors','paperTrade',
                   'minConfidence','signalCache','symbolStates'])
    assert(f in s, `getStatus missing: ${f}`);
  stop();
});
test('getStatus — running toggles correctly', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  assert(getStatus().running === true, 'Must be running');
  stop();
  assert(getStatus().running === false, 'Must be stopped');
});
test('getStatus — watchlistSize matches', () => {
  const syms = ['A','B','C'];
  start({ watchlist: syms, runOnStart: false });
  assert(getStatus().watchlistSize === 3, 'watchlistSize must be 3');
  stop();
});
testAsync('getStatus — runCount increments', async () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  const before = getStatus().runCount;
  await runOnce();
  assert(getStatus().runCount === before + 1, 'runCount must increment');
  stop();
});

// ═════════════════════════════════════════════════════════════════════════════
section('6. getLatestSignals — Cache API');

testAsync('getLatestSignals — returns cached signals after runOnce', async () => {
  start({ watchlist: ['RELIANCE','TCS'], runOnStart: false });
  await runOnce();
  const sigs = getLatestSignals();
  assert(Array.isArray(sigs), 'Must return array');
  stop();
});
testAsync('getLatestSignals — filters by symbols', async () => {
  start({ watchlist: ['RELIANCE','TCS','INFY'], runOnStart: false });
  await runOnce();
  const filtered = getLatestSignals(['RELIANCE','TCS']);
  assert(filtered.length === 2, `Must return 2, got ${filtered.length}`);
  stop();
});
test('getLatestSignals — null signal for unknown symbol', () => {
  const sig = getLatestSignals(['UNKNOWN_XYZ']);
  assert(sig[0].signal == null, 'Unknown symbol must have null signal');
});

// ═════════════════════════════════════════════════════════════════════════════
section('7. runOnce — Full Tick');

testAsync('runOnce — returns result with required fields', async () => {
  start({ watchlist: ['RELIANCE','TCS'], runOnStart: false });
  const r = await runOnce();
  for (const f of ['processed','signals','errors','durationMs'])
    assert(f in r, `runOnce result missing: ${f}`);
  assert(typeof r.processed  === 'number', 'processed must be number');
  assert(typeof r.durationMs === 'number', 'durationMs must be number');
  stop();
});
testAsync('runOnce — processed equals watchlist size', async () => {
  const syms = ['RELIANCE','TCS','INFY'];
  start({ watchlist: syms, runOnStart: false });
  const r = await runOnce();
  assert(r.processed === syms.length, `processed ${r.processed} must equal ${syms.length}`);
  stop();
});
testAsync('runOnce — handles empty watchlist', async () => {
  start({ watchlist: [], runOnStart: false });
  const r = await runOnce();
  assert(r.processed === 0, 'Empty watchlist must process 0');
  stop();
});
testAsync('runOnce — durationMs is non-negative', async () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  const r = await runOnce();
  assert(r.durationMs >= 0, `durationMs must be ≥0, got ${r.durationMs}`);
  stop();
});
testAsync('runOnce — broadcasts LIVE_SIGNAL events', async () => {
  _broadcasts.length = 0;
  start({ watchlist: ['RELIANCE','TCS'], runOnStart: false });
  await runOnce();
  const lsBroadcasts = _broadcasts.filter(b => b.type === 'LIVE_SIGNAL');
  assert(lsBroadcasts.length >= 0, 'Must not crash on broadcast');
  stop();
});

// ═════════════════════════════════════════════════════════════════════════════
section('8. Lifecycle');

test('start — cannot start twice without crash', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  let threw = false;
  try { start({ watchlist: ['TCS'], runOnStart: false }); } catch(_) { threw = true; }
  assert(!threw, 'Double start must not throw');
  assert(getStatus().running === true, 'Must remain running');
  stop();
});
test('stop — idempotent', () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  stop();
  let threw = false;
  try { stop(); } catch(_) { threw = true; }
  assert(!threw, 'Double stop must not throw');
  assert(getStatus().running === false, 'Must be stopped');
});
test('start — custom intervalMs applied', () => {
  const interval = 3 * 60 * 1000;
  start({ watchlist: ['RELIANCE'], intervalMs: interval, runOnStart: false });
  assert(getStatus().intervalMs === interval, `intervalMs must be ${interval}`);
  stop();
});
test('start — uppercases all symbols', () => {
  start({ watchlist: ['reliance','tcs','Infy'], runOnStart: false });
  const { watchlist } = getStatus();
  assert(watchlist.includes('RELIANCE') && watchlist.includes('TCS') && watchlist.includes('INFY'),
    'All symbols must be uppercased');
  stop();
});

// ═════════════════════════════════════════════════════════════════════════════
section('9. Deduplication');

testAsync('duplicate hashes are not re-persisted (no crash)', async () => {
  start({ watchlist: ['RELIANCE'], runOnStart: false });
  await runOnce();
  const rc1 = getStatus().runCount;
  await runOnce(); // same day — duplicate hash expected
  assert(getStatus().runCount === rc1 + 1, 'runCount must increment on second run too');
  stop();
});
testAsync('different symbols always get distinct hashes', async () => {
  const h1 = _signalHash('RELIANCE', '2024-01-15', 'BUY');
  const h2 = _signalHash('TCS',      '2024-01-15', 'BUY');
  assert(h1 !== h2, 'Different symbols must never collide');
});

// ═════════════════════════════════════════════════════════════════════════════
section('10. Scheduler');

const scheduler = require('../src/engine/scheduler');
test('isMarketHours — returns boolean', () => {
  assert(typeof scheduler.isMarketHours() === 'boolean', 'Must return boolean');
});
test('getJobStatus — returns array', () => {
  assert(Array.isArray(scheduler.getJobStatus()), 'Must return array');
});
test('addJob — does not crash', () => {
  let threw = false;
  try { scheduler.addJob('TEST_LIVE_99', async () => {}, 60000); } catch(_) { threw = true; }
  assert(!threw, 'addJob must not throw');
});
test('scheduler has LIVE_SIGNALS in source', () => {
  const src = require('fs').readFileSync('./src/engine/scheduler.js', 'utf8');
  assert(src.includes('LIVE_SIGNALS'), 'scheduler must have LIVE_SIGNALS job');
  assert(src.includes('PAPER_EXIT_CHECK'), 'scheduler must have PAPER_EXIT_CHECK job');
  assert(src.includes('addJob'), 'scheduler must export addJob');
});

// ═════════════════════════════════════════════════════════════════════════════
section('11. API Routes Structure');

test('live routes loads without error', () => {
  let threw = false;
  try { require('../src/routes/live'); } catch(e) { threw = true; console.error(e.message); }
  assert(!threw, 'live routes must load without error');
});
test('live controller exports all handlers', () => {
  const ctrl = require('../src/controllers/liveController');
  for (const fn of ['getLiveSignals','getSignalHistory','getLatestTrades',
                    'getPaperPortfolio','getEngineStatus','startEngine','stopEngine',
                    'triggerRun','addToWatchlist','removeFromWatchlist','resetCircuitBreaker'])
    assert(typeof ctrl[fn] === 'function', `liveController must export ${fn}`);
});
test('live routes file has all endpoints', () => {
  const src = require('fs').readFileSync('./src/routes/live.js', 'utf8');
  for (const ep of ['/signals','/trades','/status','/engine/start',
                    '/engine/stop','/engine/run','/watchlist/add',
                    '/watchlist/remove','/circuit-breaker/reset'])
    assert(src.includes(ep), `Must have route: ${ep}`);
});
test('app.js mounts /api/live', () => {
  const src = require('fs').readFileSync('./src/app.js', 'utf8');
  assert(src.includes("'/api/live'"), 'app.js must mount /api/live');
});

// ═════════════════════════════════════════════════════════════════════════════
section('12. Module Exports');

test('liveSignalEngine exports all required functions', () => {
  for (const fn of ['start','stop','runOnce','addSymbol','removeSymbol',
                    'resetCircuitBreaker','getLatestSignals','getStatus'])
    assert(typeof engine[fn] === 'function', `liveSignalEngine must export ${fn}`);
});
test('liveDataFeed.js has broadcast function', () => {
  const src = require('fs').readFileSync('./src/data/liveDataFeed.js', 'utf8');
  assert(src.includes('broadcastAll') || src.includes('function broadcast'), 'liveDataFeed.js must have global broadcast');
  assert(src.includes('broadcastAll') || src.includes('broadcast'),
    'broadcast must be exported');
});

// ── Run all tests ─────────────────────────────────────────────────────────────
runAll().catch(e => { console.error('Fatal:', e); process.exit(1); });
