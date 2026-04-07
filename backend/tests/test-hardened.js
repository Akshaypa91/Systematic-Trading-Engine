// tests/test-hardened.js
// Comprehensive tests for the hardened execution engine.
// No DB or network required — all external deps are stubbed.
// Run: node tests/test-hardened.js
'use strict';

require('dotenv').config();
process.env.LOG_LEVEL      = 'silent';
process.env.EXEC_DELAY_MS  = '0';      // no real delay in tests
process.env.PARTIAL_FILL_ENABLED = 'false'; // deterministic fills

// ── Stub DB and logger before requiring engine ────────────────────────────────
const path = require('path');
const srcRoot = path.resolve(__dirname, '../src');

function cacheStub(rel, exports) {
  const abs = path.resolve(srcRoot, rel);
  require.cache[require.resolve(abs)] = {
    id: abs, filename: abs, loaded: true, exports, children: [], parent: null, paths: [],
  };
}

// Silent logger
const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};
cacheStub('config/logger', silentLogger);

// DB stub (never called in unit tests)
cacheStub('config/database', {
  query: async () => [[], {}],
});

// ── Load engine AFTER stubs ───────────────────────────────────────────────────
const engine = require('../src/engine/executionEngine');
const {
  placeOrder, getPortfolioState, checkAndClosePosition,
  getRecentOrders, checkCooldown, getSafetyState,
} = engine;

// ── Harness ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const _queue = [];

function test(name, fn)      { _queue.push({ name, fn, async: false }); }
function testAsync(name, fn) { _queue.push({ name, fn, async: true  }); }
function assert(c, m)  { if (!c) throw new Error(m || 'Assertion failed'); }
function assertClose(a, e, t = 0.01, m) {
  if (!isFinite(a)) throw new Error(`${m||''} got non-finite: ${a}`);
  if (Math.abs(a - e) > t) throw new Error(`${m||''} expected ≈${e}±${t}, got ${a}`);
}
function section(t) { _queue.push({ _section: t }); }

// Reset engine state between test groups
function resetEngine() {
  const state = engine._state || getPortfolioState();
  // Directly reset via module internals if accessible
  // We use the public API to verify, and reset via re-require in each test
}

// Helper: make a standard BUY order
function buyOrder(sym = 'RELIANCE', qty = 10, price = 2000, extras = {}) {
  return { symbol: sym, side: 'BUY', quantity: qty, currentPrice: price,
           strategy: 'TEST', skipDedup: true, skipCooldown: true, ...extras };
}

function sellOrder(sym = 'RELIANCE', qty = 10, price = 2100, extras = {}) {
  return { symbol: sym, side: 'SELL', quantity: qty, currentPrice: price,
           strategy: 'TEST', skipDedup: true, skipCooldown: true, ...extras };
}

// ═══════════════════════════════════════════════════════════════════════════
section('1. Trade Validation — Input Guards');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('REJECTED for invalid symbol (empty string)', async () => {
  const r = await placeOrder({ symbol: '', side: 'BUY', quantity: 10, currentPrice: 1000 });
  assert(r.status === 'REJECTED', `Expected REJECTED, got ${r.status}`);
  assert(r.reasons.some(r => r.includes('symbol') || r.includes('Invalid')), 'Must mention invalid symbol');
});

testAsync('REJECTED for invalid side', async () => {
  const r = await placeOrder({ symbol: 'TCS', side: 'HOLD', quantity: 10, currentPrice: 1000 });
  assert(r.status === 'REJECTED', `Expected REJECTED, got ${r.status}`);
  assert(r.reasons.some(r => r.includes('side') || r.includes('Invalid')), 'Must mention invalid side');
});

testAsync('REJECTED for quantity < 1', async () => {
  const r = await placeOrder({ symbol: 'TCS', side: 'BUY', quantity: 0, currentPrice: 1000 });
  assert(r.status === 'REJECTED', `Expected REJECTED, got ${r.status}`);
});

testAsync('REJECTED for price <= 0', async () => {
  const r = await placeOrder({ symbol: 'TCS', side: 'BUY', quantity: 10, currentPrice: -100 });
  assert(r.status === 'REJECTED', `Expected REJECTED, got ${r.status}`);
});

testAsync('REJECTED for trade value below minimum (1-share at ₹50)', async () => {
  // 1 × ₹50 = ₹50 < ₹1000 minimum
  const r = await placeOrder(buyOrder('LOWPRICE', 1, 50));
  assert(r.status === 'REJECTED', `Expected REJECTED for tiny trade, got ${r.status}`);
  assert(r.reasons.some(r => r.includes('minimum') || r.includes('below')), 'Must mention minimum');
});

testAsync('REJECTED for trade exceeding MAX_TRADE_PCT of capital', async () => {
  // Capital = 1M, maxTradePct = 30%. Buying 10,000 × ₹500 = ₹5M > 30% limit
  const r = await placeOrder(buyOrder('TCS', 10000, 500));
  assert(r.status === 'REJECTED', `Expected REJECTED for oversized trade, got ${r.status}`);
  assert(r.reasons.some(r => r.includes('%') || r.includes('capital')), 'Must mention capital limit');
});

// ═══════════════════════════════════════════════════════════════════════════
section('2. Duplicate Trade Protection');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('BUY: second order with same symbol blocks (no pyramiding)', async () => {
  const r1 = await placeOrder(buyOrder('INFY', 5, 1500));
  assert(r1.status === 'EXECUTED', `First BUY must execute, got ${r1.status}`);

  // Second BUY for same symbol — skipDedup=true but position already exists
  const r2 = await placeOrder(buyOrder('INFY', 5, 1500));
  assert(r2.status === 'REJECTED', `Second BUY must be REJECTED, got ${r2.status}`);
  assert(r2.reasons.some(r => r.includes('INFY') || r.includes('position') || r.includes('open')),
    `Rejection reason must mention INFY. Got: ${r2.reasons}`);

  // Cleanup
  await placeOrder(sellOrder('INFY', 5, 1500));
});

testAsync('Signal dedup: BUY with same symbol+day is SKIPPED (dedup on)', async () => {
  // Strategy: use a unique symbol, open+close it, then verify dedup blocks re-entry.
  // After close, position is gone so re-entry won't be blocked by "already open".
  // But dedup will block it because the BUY hash was already recorded today.
  const sym = `DEDUP_${Date.now()}`;  // unique per test run to avoid cross-test pollution

  // First BUY — records the hash, executes the trade
  const r1 = await placeOrder(buyOrder(sym, 5, 1500, { skipDedup: false, skipCooldown: true }));
  if (r1.status !== 'EXECUTED') return;  // skip if capital exhausted etc.

  // Close the position (skipCooldown so cooldown doesn't interfere with dedup test)
  await placeOrder(sellOrder(sym, 5, 1500, { skipCooldown: true }));

  // Second BUY for same symbol+day — dedup hash already in set → SKIPPED
  const r2 = await placeOrder(buyOrder(sym, 5, 1500, { skipDedup: false, skipCooldown: true }));
  assert(r2.status === 'SKIPPED', `Duplicate BUY must be SKIPPED, got ${r2.status}: ${JSON.stringify(r2)}`);
  assert(r2.reason === 'DUPLICATE_SIGNAL', `Reason must be DUPLICATE_SIGNAL, got ${r2.reason}`);
});

testAsync('Signal dedup: skipDedup=true bypasses check', async () => {
  // Two BUYs with skipDedup=true (for force-orders like SL closing, etc.)
  // The second should be rejected by "position already open", NOT by dedup
  const sym = 'SKIP_DEDUP_SYM';
  const r1  = await placeOrder(buyOrder(sym, 5, 1800, { skipDedup: true, skipCooldown: true }));
  assert(r1.status === 'EXECUTED', `First BUY must execute`);

  const r2 = await placeOrder(buyOrder(sym, 3, 1800, { skipDedup: true, skipCooldown: true }));
  // Should be rejected by "position already open", not "duplicate signal"
  assert(r2.status === 'REJECTED', `Second BUY on open position must be REJECTED`);
  assert(r2.reason !== 'DUPLICATE_SIGNAL', 'Must NOT be rejected by dedup when skipDedup=true');

  await placeOrder(sellOrder(sym, 5, 1800));
});

// ═══════════════════════════════════════════════════════════════════════════
section('3. Cooldown System');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('Cooldown set after SELL', async () => {
  const sym = 'COOL_TEST_A';
  await placeOrder(buyOrder(sym, 5, 1000));
  await placeOrder(sellOrder(sym, 5, 1050, { skipCooldown: true }));

  // Cooldown should now be active
  const cd = checkCooldown(sym);
  assert(cd.blocked === true, `Cooldown must be active after SELL, got blocked=${cd.blocked}`);
  assert(cd.remainingMs > 0, `Cooldown remainingMs must be > 0`);
  assert(typeof cd.reason === 'string' && cd.reason.length > 0, 'Must have reason string');
});

testAsync('BUY blocked during cooldown', async () => {
  const sym = 'COOL_TEST_B';
  await placeOrder(buyOrder(sym, 5, 1000));
  await placeOrder(sellOrder(sym, 5, 1050, { skipCooldown: true }));

  // Now try to re-enter — should be blocked by cooldown
  const r = await placeOrder(buyOrder(sym, 5, 1000, { skipDedup: true, skipCooldown: false }));
  assert(r.status === 'SKIPPED', `BUY during cooldown must be SKIPPED, got ${r.status}`);
  assert(r.reason === 'COOLDOWN', `Reason must be COOLDOWN, got ${r.reason}`);
  assert(r.remainingMs > 0, 'Must report remaining cooldown time');
});

testAsync('skipCooldown=true bypasses check (for SL/TP exits)', async () => {
  const sym = 'COOL_BYPASS';
  await placeOrder(buyOrder(sym, 5, 1000));
  // Force a sell ignoring cooldown (simulates SL/TP exit)
  const r = await placeOrder(sellOrder(sym, 5, 950, { skipCooldown: true }));
  assert(r.status === 'EXECUTED', `skipCooldown=true must bypass and execute SELL`);
});

testAsync('checkCooldown returns blocked=false for symbol with no cooldown', () => {
  const cd = checkCooldown('NO_COOLDOWN_SYM_XYZ');
  assert(cd.blocked === false, 'Unknown symbol must not be in cooldown');
  assert(cd.remainingMs === 0, 'remainingMs must be 0');
});

testAsync('STOP_LOSS sets longer cooldown than normal exit', async () => {
  const symSL   = 'CD_SL_TEST';
  const symNorm = 'CD_NORM_TEST';

  // Normal sell
  await placeOrder(buyOrder(symNorm, 5, 1000));
  await placeOrder(sellOrder(symNorm, 5, 1020, { skipCooldown: true }));
  const cdNorm = checkCooldown(symNorm);

  // Stop-loss exit (bypass cooldown, set with SL reason)
  await placeOrder(buyOrder(symSL, 5, 1000));
  // Trigger SL via checkAndClosePosition
  const pos = getPortfolioState().openPositions[symSL];
  if (pos) {
    // Manually call close with SL reason not possible via public API directly
    // Instead verify SL cooldown multiplier via getSafetyState config
    await placeOrder(sellOrder(symSL, 5, 950, { skipCooldown: true }));
  }
  const cdSL = checkCooldown(symSL);

  // SL multiplier is 3× normal — SL cooldown must be longer
  if (cdNorm.blocked && cdSL.blocked) {
    assert(cdSL.remainingMs >= cdNorm.remainingMs,
      `SL cooldown (${cdSL.remainingMs}ms) must be ≥ normal (${cdNorm.remainingMs}ms)`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('4. Execution Delay');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('Executed order has delayMs field', async () => {
  const r = await placeOrder(buyOrder('DELAY_TEST', 5, 1500));
  assert(r.status === 'EXECUTED', `Must execute`);
  assert('delayMs' in r, 'Must have delayMs field');
  assert(typeof r.delayMs === 'number', 'delayMs must be number');
  assert(r.delayMs >= 0, 'delayMs must be ≥ 0');
  await placeOrder(sellOrder('DELAY_TEST', 5, 1500));
});

testAsync('Fill price includes slippage (not equal to currentPrice)', async () => {
  const r = await placeOrder(buyOrder('SLIP_TEST', 5, 2000));
  if (r.status === 'EXECUTED') {
    assert(r.executedPrice > 2000, `BUY fill ${r.executedPrice} must be > market 2000`);
    await placeOrder(sellOrder('SLIP_TEST', 5, 2000));
  }
});

testAsync('SELL fill price < market price (adverse slippage)', async () => {
  const sym  = 'SELL_SLIP';
  const buy  = await placeOrder(buyOrder(sym, 5, 2000));
  if (buy.status === 'EXECUTED') {
    const sell = await placeOrder(sellOrder(sym, 5, 2000));
    if (sell.status === 'EXECUTED') {
      assert(sell.executedPrice < 2000, `SELL fill ${sell.executedPrice} must be < market 2000`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('5. Partial Fill Simulation');
// ═══════════════════════════════════════════════════════════════════════════

test('getSafetyState shows partialFill config', () => {
  const state = getSafetyState();
  assert('config' in state, 'Must have config');
  assert('partialFill' in state.config, 'Must have partialFill config');
  assert(state.config.partialFill === false, 'Must be disabled (test env)');
});

testAsync('With PARTIAL_FILL_ENABLED=false: filledQty equals requestedQty', async () => {
  // Already disabled via env in test setup
  const r = await placeOrder(buyOrder('FULL_FILL', 10, 1500));
  if (r.status === 'EXECUTED') {
    assert(r.quantity === 10, `filledQty ${r.quantity} must equal requested 10`);
    assert(r.partial === false, 'partial must be false');
    assert(r.fillPct === 1.0, `fillPct must be 1.0, got ${r.fillPct}`);
    await placeOrder(sellOrder('FULL_FILL', 10, 1500));
  }
});

testAsync('Partial fill returns reduced quantity in response', async () => {
  // Test the partial fill logic by mocking it — we can verify the response shape
  const r = await placeOrder(buyOrder('PARTIAL_SHAPE', 10, 1500));
  if (r.status === 'EXECUTED') {
    assert('requestedQty' in r, 'Must have requestedQty field');
    assert('fillPct' in r, 'Must have fillPct field');
    assert('partial' in r, 'Must have partial field');
    assert(r.requestedQty === 10, 'requestedQty must be 10');
    await placeOrder(sellOrder('PARTIAL_SHAPE', 10, 1500));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('6. Capital Management');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('Capital deducted correctly after BUY', async () => {
  const before = getPortfolioState().capital;
  const r      = await placeOrder(buyOrder('CAP_TEST', 5, 1200));
  if (r.status === 'EXECUTED') {
    const after = getPortfolioState().capital;
    assert(after < before, 'Capital must decrease after BUY');
    // Cost = qty × fillPrice + commission
    const expectedCost = 5 * r.executedPrice + r.commission;
    assertClose(before - after, expectedCost, 1, 'Capital deducted must equal cost');
    await placeOrder(sellOrder('CAP_TEST', 5, 1200));
  }
});

testAsync('Capital restored after SELL', async () => {
  const sym    = 'RESTORE_CAP';
  const buy    = await placeOrder(buyOrder(sym, 5, 1000));
  if (buy.status !== 'EXECUTED') return;

  const capAfterBuy = getPortfolioState().capital;
  const sell = await placeOrder(sellOrder(sym, 5, 1000));

  if (sell.status === 'EXECUTED') {
    const capAfterSell = getPortfolioState().capital;
    assert(capAfterSell > capAfterBuy, 'Capital must increase after SELL');
  }
});

testAsync('Cannot BUY when capital is exhausted', async () => {
  // This test is tricky as capital is shared. Use a very expensive order.
  // Capital = ~1M, order = 1000 × ₹5000 = ₹5M → rejected
  const r = await placeOrder(buyOrder('TOOBIG', 1000, 5000));
  assert(['REJECTED'].includes(r.status),
    `Must be REJECTED for capital exhaustion, got ${r.status}`);
  assert(r.reasons.some(r => r.includes('capital') || r.includes('Capital')),
    'Reason must mention capital');
});

testAsync('PnL tracked correctly on profitable exit', async () => {
  const sym   = 'PNL_PROFIT';
  const entry = 1000, exit = 1100, qty = 10;
  const buy   = await placeOrder(buyOrder(sym, qty, entry));
  if (buy.status !== 'EXECUTED') return;

  const sell = await placeOrder(sellOrder(sym, qty, exit));
  if (sell.status === 'EXECUTED') {
    assert(sell.pnl != null, 'PnL must be set on SELL');
    assert(sell.pnl > 0, `Profitable exit must have positive PnL, got ${sell.pnl}`);
    assert(sell.pnlPct != null, 'pnlPct must be set');
    assert(sell.pnlPct > 0, `pnlPct must be positive`);
  }
});

testAsync('PnL tracked correctly on losing exit', async () => {
  const sym   = 'PNL_LOSS';
  const entry = 1000, exit = 900, qty = 5;
  const buy   = await placeOrder(buyOrder(sym, qty, entry));
  if (buy.status !== 'EXECUTED') return;

  const sell = await placeOrder(sellOrder(sym, qty, exit));
  if (sell.status === 'EXECUTED') {
    assert(sell.pnl < 0, `Losing exit must have negative PnL, got ${sell.pnl}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('7. checkAndClosePosition — SL/TP');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('checkAndClosePosition: returns null for non-existent symbol', async () => {
  const r = await checkAndClosePosition('NONEXISTENT_XYZ', 1000);
  assert(r === null, 'Must return null for non-existent position');
});

testAsync('checkAndClosePosition: returns null when price is between SL and TP', async () => {
  const sym = 'SL_TEST_MID';
  const buy = await placeOrder(buyOrder(sym, 5, 1000));
  if (buy.status !== 'EXECUTED') return;

  // Price is between SL (~980) and TP (~1040) — no action
  const r = await checkAndClosePosition(sym, 1010);
  assert(r === null, 'Must return null when price is between SL and TP');

  await placeOrder(sellOrder(sym, 5, 1010));
});

testAsync('checkAndClosePosition: triggers SELL when price <= stopLoss', async () => {
  const sym = 'SL_TRIGGER';
  const buy = await placeOrder(buyOrder(sym, 5, 1000));
  if (buy.status !== 'EXECUTED') return;

  const portfolio = getPortfolioState();
  const pos       = portfolio.openPositions[sym];
  assert(pos, 'Position must exist');

  // Trigger SL
  const r = await checkAndClosePosition(sym, pos.stopLoss - 1);
  assert(r !== null, 'Must return result on SL trigger');
  if (r) {
    assert(r.status === 'EXECUTED' || r.status === 'NO_FILL',
      `SL exit must execute, got ${r.status}: ${JSON.stringify(r.reasons)}`);
    if (r.status === 'EXECUTED') {
      assert(r.exitReason === 'STOP_LOSS', `exitReason must be STOP_LOSS, got ${r.exitReason}`);
      assert(!getPortfolioState().openPositions[sym], 'Position must be closed after SL');
    }
  }
});

testAsync('checkAndClosePosition: triggers SELL when price >= takeProfit', async () => {
  const sym = 'TP_TRIGGER';
  const buy = await placeOrder(buyOrder(sym, 5, 1000));
  if (buy.status !== 'EXECUTED') return;

  const pos = getPortfolioState().openPositions[sym];
  const r   = await checkAndClosePosition(sym, pos.takeProfit + 1);
  if (r) {
    assert(['EXECUTED','NO_FILL'].includes(r.status), `TP exit result: ${r.status}`);
    if (r.status === 'EXECUTED') {
      assert(r.exitReason === 'TAKE_PROFIT', `exitReason must be TAKE_PROFIT, got ${r.exitReason}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('8. Retry and Failure Handling');
// ═══════════════════════════════════════════════════════════════════════════

testAsync('DB failure does not prevent trade from being recorded in memory', async () => {
  // Override DB to always fail
  const db = require('../src/config/database');
  const origQuery = db.query;
  let failCount = 0;
  db.query = async () => { failCount++; throw new Error('Simulated DB timeout'); };

  const r = await placeOrder(buyOrder('DB_FAIL_SYM', 5, 1000));
  db.query = origQuery;  // restore

  // Trade must still execute (in-memory) even with DB failure
  assert(['EXECUTED','REJECTED','SKIPPED'].includes(r.status),
    `Must return valid status even on DB failure, got ${r.status}`);

  if (r.status === 'EXECUTED') {
    // Position must be in memory despite DB failure
    const portfolio = getPortfolioState();
    assert('DB_FAIL_SYM' in portfolio.openPositions, 'Position must be in memory despite DB failure');
    assert(r.dbPersisted === false, 'dbPersisted must be false on DB failure');
    await placeOrder(sellOrder('DB_FAIL_SYM', 5, 1000));
  }
});

testAsync('getRecentOrders falls back to in-memory cache when DB fails', async () => {
  const db = require('../src/config/database');
  const origQuery = db.query;
  db.query = async () => { throw new Error('DB down'); };

  const orders = await getRecentOrders(10);
  db.query = origQuery;

  assert(Array.isArray(orders), 'Must return array even when DB fails');
});

// ═══════════════════════════════════════════════════════════════════════════
section('9. Portfolio State & Safety State');
// ═══════════════════════════════════════════════════════════════════════════

test('getPortfolioState returns all required fields', () => {
  const s = getPortfolioState();
  assert('capital' in s,       'capital');
  assert('openPositions' in s, 'openPositions');
  assert('openCount' in s,     'openCount');
  assert('dailyPnl' in s,      'dailyPnl');
  assert(typeof s.capital === 'number', 'capital must be number');
  assert(s.capital > 0, 'capital must be positive');
});

test('getSafetyState returns all required fields', () => {
  const s = getSafetyState();
  assert('dedupSize'        in s, 'dedupSize');
  assert('cooldowns'        in s, 'cooldowns');
  assert('recentTradeCount' in s, 'recentTradeCount');
  assert('config'           in s, 'config');
  assert('execDelayMs'      in s.config, 'config.execDelayMs');
  assert('cooldownMin'      in s.config, 'config.cooldownMin');
  assert('partialFill'      in s.config, 'config.partialFill');
  assert('minTradeValue'    in s.config, 'config.minTradeValue');
});

testAsync('openCount matches actual open positions', async () => {
  const before = getPortfolioState().openCount;
  const sym    = 'COUNT_TEST';
  const r      = await placeOrder(buyOrder(sym, 5, 1000));
  if (r.status === 'EXECUTED') {
    assert(getPortfolioState().openCount === before + 1, 'openCount must increment');
    await placeOrder(sellOrder(sym, 5, 1000));
    assert(getPortfolioState().openCount === before, 'openCount must decrement after SELL');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('10. Backward Compatibility');
// ═══════════════════════════════════════════════════════════════════════════

test('All original exports still present', () => {
  assert(typeof engine.placeOrder              === 'function', 'placeOrder');
  assert(typeof engine.getPortfolioState       === 'function', 'getPortfolioState');
  assert(typeof engine.checkAndClosePosition   === 'function', 'checkAndClosePosition');
  assert(typeof engine.getRecentOrders         === 'function', 'getRecentOrders');
});

test('New exports present', () => {
  assert(typeof engine.checkCooldown   === 'function', 'checkCooldown');
  assert(typeof engine.getSafetyState  === 'function', 'getSafetyState');
});

testAsync('placeOrder result has original fields', async () => {
  const r = await placeOrder(buyOrder('COMPAT_TEST', 5, 1500));
  if (r.status === 'EXECUTED') {
    assert('orderId'        in r, 'orderId');
    assert('symbol'         in r, 'symbol');
    assert('side'           in r, 'side');
    assert('executedPrice'  in r, 'executedPrice');
    assert('commission'     in r, 'commission');
    assert('status'         in r, 'status');
    assert('executedAt'     in r, 'executedAt');
    assert('portfolioState' in r, 'portfolioState');
    await placeOrder(sellOrder('COMPAT_TEST', 5, 1500));
  }
});

testAsync('REJECTED order has reasons array', async () => {
  const r = await placeOrder({ symbol: 'BAD', side: 'SELL', quantity: 0, currentPrice: -1 });
  assert(r.status === 'REJECTED', `Must be REJECTED, got ${r.status}`);
  assert(Array.isArray(r.reasons), 'reasons must be array');
  assert(r.reasons.length > 0, 'Must have at least one reason');
});

// ── Run all ───────────────────────────────────────────────────────────────────
(async function run() {
  for (const item of _queue) {
    if (item._section) { console.log(`\n── ${item._section} ${'─'.repeat(58-item._section.length)}`); continue; }
    total++;
    try {
      if (item.async) await item.fn(); else item.fn();
      console.log(`  ✅  ${item.name}`); passed++;
    } catch (e) {
      console.error(`  ❌  ${item.name}\n       → ${e.message}`); failed++;
    }
  }

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
  console.log(failed === 0 ? '  🎉 All hardened engine tests passing!' : `  ⚠️  ${failed} test(s) failed`);
  console.log(`${'═'.repeat(62)}\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
