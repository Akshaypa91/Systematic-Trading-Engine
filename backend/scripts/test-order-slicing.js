// scripts/test-order-slicing.js
// Verifies manageEntries slices a large sized entry into child orders when
// LIVE_EXEC_MAX_CHILD_QTY is set. Offline (interval forced to 0 so no waiting).
//   node scripts/test-order-slicing.js
'use strict';
process.env.LIVE_EXECUTION_ENABLED       = 'true';
process.env.LIVE_AUTO_ENTRIES_ENABLED    = 'true';
process.env.LIVE_SIZING_METHOD           = 'fixed';
process.env.LIVE_AUTO_QTY                = '250';
process.env.LIVE_EXEC_MAX_CHILD_QTY      = '100';
process.env.LIVE_EXEC_CHILD_INTERVAL_MS  = '0';
process.env.LIVE_AUTO_MIN_CONFIDENCE     = '0.6';
process.env.LIVE_MAX_CONCURRENT_POSITIONS = '5';

const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.error = () => {}; logger.debug = () => {};

const lts     = require('../src/services/liveTradingService');
const targets = require('../src/risk/positionTargets');

let orders = [];
lts.getPositions      = async () => [];
lts.getRiskLimits     = async () => ({});          // no maxPositionSize cap
lts.getFundsNormalized = async () => ({ availableCash: 0 });
lts.placeOrder        = async (u, o) => { orders.push(o.qty); return { success: true }; };
targets.getActiveTargets = async () => [];
targets.upsertTarget  = async () => [];

const engine = require('../src/engine/liveExecutionEngine');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('manageEntries — order slicing');
  const r = await engine.manageEntries(1, { signals: [{ symbol: 'RELIANCE', signal: 'BUY', confidence: 0.9, price: 100 }] });
  ok('entry counted once', r.placed === 1, JSON.stringify(r));
  ok('placed 3 child orders', orders.length === 3, JSON.stringify(orders));
  ok('children sum to 250', orders.reduce((a, b) => a + b, 0) === 250, JSON.stringify(orders));
  ok('each child ≤ 100', orders.every(q => q <= 100), JSON.stringify(orders));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
