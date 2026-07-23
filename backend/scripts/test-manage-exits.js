// scripts/test-manage-exits.js
// Tests liveExecutionEngine.manageExits with stubbed targets / positions /
// exit calls. Offline — no real orders.  node scripts/test-manage-exits.js
'use strict';
process.env.LIVE_EXECUTION_ENABLED = 'true';

const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.error = () => {}; logger.debug = () => {};

const lts     = require('../src/services/liveTradingService');
const targets = require('../src/risk/positionTargets');

let cfg;
const reset = () => { cfg = { targets: [], positions: [], exits: [], deactivated: [], trailUpdates: [] }; };
reset();

// Stub the repo + trade service (same module instances the engine uses).
targets.getActiveTargets = async () => cfg.targets;
targets.deactivate       = async (u, sym) => { cfg.deactivated.push(sym); };
targets.updateTrailRef   = async (u, sym, ref) => { cfg.trailUpdates.push([sym, ref]); };
lts.getPositions         = async () => cfg.positions;
lts.exitPosition         = async (u, sym) => { cfg.exits.push(sym); return { ok: true }; };

const engine = require('../src/engine/liveExecutionEngine');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('manageExits');

  // Stop-loss breach → exit fired + target deactivated.
  reset();
  cfg.targets   = [{ userId: 1, symbol: 'RELIANCE', side: 'BUY', stopLoss: 95, takeProfit: 120 }];
  cfg.positions = [{ symbol: 'RELIANCE', qty: 10, ltp: 94, avgPrice: 100 }];
  let r = await engine.manageExits(1);
  ok('SL breach fires exit', r.exits === 1 && cfg.exits.includes('RELIANCE'), JSON.stringify(r));
  ok('target deactivated after exit', cfg.deactivated.includes('RELIANCE'));

  // Inside band → no exit.
  reset();
  cfg.targets   = [{ userId: 1, symbol: 'TCS', side: 'BUY', stopLoss: 95, takeProfit: 120 }];
  cfg.positions = [{ symbol: 'TCS', qty: 5, ltp: 105, avgPrice: 100 }];
  r = await engine.manageExits(1);
  ok('inside band → no exit', r.exits === 0 && cfg.exits.length === 0, JSON.stringify(r));

  // Target with no matching open position → deactivated, no exit.
  reset();
  cfg.targets   = [{ userId: 1, symbol: 'INFY', side: 'BUY', stopLoss: 95 }];
  cfg.positions = [];   // position already closed
  r = await engine.manageExits(1);
  ok('orphan target deactivated', r.deactivated === 1 && cfg.deactivated.includes('INFY') && r.exits === 0, JSON.stringify(r));

  // Trailing high-water advances (no exit) → trailRef persisted.
  reset();
  cfg.targets   = [{ userId: 1, symbol: 'LT', side: 'BUY', trailingPct: 0.02, trailRef: 120 }];
  cfg.positions = [{ symbol: 'LT', qty: 3, ltp: 130, avgPrice: 100 }];
  r = await engine.manageExits(1);
  ok('new high persists trailRef, no exit', r.exits === 0 && cfg.trailUpdates.some(([s, v]) => s === 'LT' && v === 130), JSON.stringify(cfg.trailUpdates));

  // Trailing stop breach → exit.
  reset();
  cfg.targets   = [{ userId: 1, symbol: 'SBIN', side: 'BUY', trailingPct: 0.02, trailRef: 120 }];
  cfg.positions = [{ symbol: 'SBIN', qty: 3, ltp: 117, avgPrice: 100 }];  // 117 < 120*0.98=117.6
  r = await engine.manageExits(1);
  ok('trailing breach fires exit', r.exits === 1 && cfg.exits.includes('SBIN'), JSON.stringify(r));

  // No targets → clean no-op.
  reset();
  r = await engine.manageExits(1);
  ok('no targets → no-op', r.checked === 0 && r.exits === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
