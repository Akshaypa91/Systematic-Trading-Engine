// scripts/test-entry-sizing.js
// Portfolio sizing + max-concurrent enforcement in manageEntries. Offline.
//   node scripts/test-entry-sizing.js
'use strict';
process.env.LIVE_EXECUTION_ENABLED     = 'true';
process.env.LIVE_AUTO_ENTRIES_ENABLED  = 'true';
process.env.LIVE_SIZING_METHOD         = 'risk';
process.env.LIVE_RISK_PER_TRADE        = '0.01';
process.env.LIVE_AUTO_SL_PCT           = '0.02';
process.env.LIVE_AUTO_MIN_CONFIDENCE   = '0.6';
process.env.LIVE_AUTO_MAX_NEW_PER_TICK = '5';
process.env.LIVE_MAX_CONCURRENT_POSITIONS = '2';

const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.error = () => {}; logger.debug = () => {};

const lts     = require('../src/services/liveTradingService');
const targets = require('../src/risk/positionTargets');

let cfg;
const reset = () => { cfg = { positions: [], targetsList: [], funds: { availableCash: 1000000 }, riskLimits: { maxPositionSize: 200000 }, orders: [] }; };
reset();
lts.getPositions      = async () => cfg.positions;
lts.getActiveTargets  = undefined;
targets.getActiveTargets = async () => cfg.targetsList;
targets.upsertTarget  = async () => [];
lts.getFundsNormalized = async () => cfg.funds;
lts.getRiskLimits     = async () => cfg.riskLimits;
lts.placeOrder        = async (u, o) => { cfg.orders.push(o); return { success: true }; };

const engine = require('../src/engine/liveExecutionEngine');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('risk-based sizing');
  // capital 1e6 · 1% = ₹10,000 risk; stop 2% of ₹100 = ₹2/share → 5,000 raw;
  // maxPositionSize ₹200,000 caps to floor(200000/100)=2,000.
  reset();
  let r = await engine.manageEntries(1, { signals: [{ symbol: 'RELIANCE', signal: 'BUY', confidence: 0.9, price: 100 }] });
  ok('placed 1', r.placed === 1, JSON.stringify(r));
  ok('sized to 2000 (risk, capped by max position value)', cfg.orders[0]?.qty === 2000, `qty=${cfg.orders[0]?.qty}`);

  console.log('max concurrent positions');
  // Already holding 2 (= MAX_CONCURRENT) → portfolio full → new signal skipped.
  reset();
  cfg.positions = [{ symbol: 'TCS', qty: 5 }, { symbol: 'INFY', qty: 5 }];
  r = await engine.manageEntries(1, { signals: [{ symbol: 'HDFCBANK', signal: 'BUY', confidence: 0.9, price: 100 }] });
  ok('portfolio full → no new entry', r.placed === 0 && cfg.orders.length === 0, JSON.stringify(r));

  // One slot free (holding 1) → allowed.
  reset();
  cfg.positions = [{ symbol: 'TCS', qty: 5 }];
  r = await engine.manageEntries(1, { signals: [{ symbol: 'HDFCBANK', signal: 'BUY', confidence: 0.9, price: 100 }] });
  ok('one free slot → entry allowed', r.placed === 1, JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
