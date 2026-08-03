// scripts/test-auto-entries.js
// Tests autonomous entries + daily-loss halt + dead-man switch with stubs.
// Offline — no real orders.  node scripts/test-auto-entries.js
'use strict';
process.env.LIVE_EXECUTION_ENABLED     = 'true';
process.env.LIVE_AUTO_ENTRIES_ENABLED  = 'true';
process.env.LIVE_AUTO_MIN_CONFIDENCE   = '0.6';
process.env.LIVE_AUTO_MAX_NEW_PER_TICK = '2';
process.env.LIVE_DEADMAN_MAX_ERRORS    = '3';

const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.error = () => {}; logger.debug = () => {};

const lts     = require('../src/services/liveTradingService');
const targets = require('../src/risk/positionTargets');

let cfg;
const reset = () => { cfg = { positions: [], targetsList: [], orders: [], setTargets: [], killEngaged: false, riskLimits: { dailyLossLimit: 25000 } }; };
reset();

lts.getPositions      = async () => cfg.positions;
lts.getRiskLimits     = async () => cfg.riskLimits;
lts.setLiveTradingEnabled = async (enabled) => { cfg.killEngaged = !enabled; };
lts.placeOrder        = async (u, o) => { cfg.orders.push(o); return { success: true, brokerOrderId: 'X' }; };
targets.getActiveTargets = async () => cfg.targetsList;
targets.upsertTarget  = async (u, sym, t) => { cfg.setTargets.push({ sym, ...t }); return []; };

const engine = require('../src/engine/liveExecutionEngine');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('manageEntries');

  // BUY above confidence, nothing held → places order + sets bracket target.
  reset();
  let r = await engine.manageEntries(1, { signals: [{ symbol: 'RELIANCE', signal: 'BUY', confidence: 0.8, price: 100 }] });
  ok('places 1 order', r.placed === 1 && cfg.orders.length === 1, JSON.stringify(r));
  ok('order is BUY 1× MARKET', cfg.orders[0].side === 'BUY' && cfg.orders[0].orderType === 'MARKET' && cfg.orders[0].confirmed === true);
  ok('sets SL/TP bracket (98/104)', cfg.setTargets[0] && cfg.setTargets[0].stopLoss === 98 && cfg.setTargets[0].takeProfit === 104, JSON.stringify(cfg.setTargets));

  // Low confidence / SELL / already-held are skipped.
  reset();
  cfg.positions = [{ symbol: 'TCS', qty: 5 }];
  r = await engine.manageEntries(1, { signals: [
    { symbol: 'INFY', signal: 'BUY',  confidence: 0.4, price: 100 },  // low conf
    { symbol: 'WIPRO', signal: 'SELL', confidence: 0.9, price: 100 }, // not BUY
    { symbol: 'TCS',  signal: 'BUY',  confidence: 0.9, price: 100 },  // already held
  ]});
  ok('all three skipped, none placed', r.placed === 0 && r.skipped === 3, JSON.stringify(r));

  // Per-tick cap respected.
  reset();
  r = await engine.manageEntries(1, { signals: [
    { symbol: 'A', signal: 'BUY', confidence: 0.9, price: 100 },
    { symbol: 'B', signal: 'BUY', confidence: 0.9, price: 100 },
    { symbol: 'C', signal: 'BUY', confidence: 0.9, price: 100 },
  ]});
  ok('caps new entries at 2/tick', r.placed === 2, JSON.stringify(r));

  console.log('daily-loss auto-halt');
  reset();
  cfg.positions = [{ symbol: 'RELIANCE', qty: 10, overallPnl: -30000 }];   // beyond 25k limit
  const halt = await engine._enforceDailyLossHalt(1);
  ok('halts when daily loss breached', halt.halted === true && cfg.killEngaged === true, JSON.stringify(halt));
  reset();
  cfg.positions = [{ symbol: 'RELIANCE', qty: 10, overallPnl: -5000 }];    // within limit
  const noHalt = await engine._enforceDailyLossHalt(1);
  ok('no halt within limit', noHalt.halted === false && cfg.killEngaged === false, JSON.stringify(noHalt));

  console.log('dead-man switch (via runOnce)');
  // Force reconcile errors by making the broker book throw; auth on, market open.
  const broker = require('../src/services/brokerAdapter');
  const upstoxAuth = require('../src/services/upstoxAuth');
  upstoxAuth.isAuthenticated = () => true;
  lts.isKillSwitchEngaged = async () => cfg.killEngaged;
  lts.reconcileFills = async () => ({});
  broker.getOrderBook = async () => { throw new Error('broker down'); };
  // db.query stub: return one open order so reconcile attempts the book (and errors).
  const db = require('../src/config/database');
  db.query = async (sql) => String(sql).includes('FROM live_orders') && String(sql).includes('NOT IN')
    ? [[{ id: 1, broker_order_id: 'A', status: 'PENDING' }]] : [[]];
  // Fake clock → market open.
  const RealDate = Date; const OPEN = Date.UTC(2025, 0, 6, 4, 30, 0);
  global.Date = class extends RealDate { constructor(...a){ a.length ? super(...a) : super(OPEN); } static now(){ return OPEN; } };
  reset(); engine._resetSafety();
  let last;
  for (let i = 0; i < 3; i++) last = await engine.runOnce(1);
  ok('dead-man engages kill switch after 3 failed ticks', last.deadman === true && cfg.killEngaged === true, JSON.stringify(last));
  global.Date = RealDate;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
