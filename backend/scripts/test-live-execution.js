// scripts/test-live-execution.js
// Tests the OMS reconciliation + runOnce guards with stubbed db / broker / auth.
// Offline — no real orders. Note: the engine reads LIVE_EXECUTION_ENABLED at
// require time, so we set it before requiring.
//   node scripts/test-live-execution.js
'use strict';
process.env.LIVE_EXECUTION_ENABLED = 'true';   // enable for the runOnce path test

const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.debug = () => {};

const db         = require('../src/config/database');
const broker     = require('../src/services/brokerAdapter');
const lts        = require('../src/services/liveTradingService');
const upstoxAuth = require('../src/services/upstoxAuth');

// Stub state
let cfg;
function reset() {
  cfg = {
    dbOrders: [],        // rows returned for the "open orders" SELECT
    book: [],            // broker order book
    killSwitch: false,
    authed: true,
    updates: [],         // captured UPDATEs
  };
}
reset();

db.query = async (sql, params) => {
  const s = String(sql);
  if (s.includes('FROM live_orders') && s.includes('NOT IN'))  return [cfg.dbOrders];
  if (s.trim().toUpperCase().startsWith('UPDATE')) { cfg.updates.push({ sql: s, params }); return [null, { affectedRows: 1 }]; }
  return [[]];
};
broker.getOrderBook = async () => cfg.book;
lts.isKillSwitchEngaged = async () => cfg.killSwitch;
lts.reconcileFills = async () => ({ updated: 0 });
upstoxAuth.isAuthenticated = () => cfg.authed;

const engine = require('../src/engine/liveExecutionEngine');

// Fake clock helper for market-hours guard.
const OPEN   = Date.UTC(2025, 0, 6, 4, 30, 0);   // Mon 10:00 IST
const CLOSED = Date.UTC(2025, 0, 6, 1, 0, 0);    // Mon 06:30 IST
const RealDate = Date;
let _clock = OPEN;
global.Date = class extends RealDate { constructor(...a){ a.length ? super(...a) : super(_clock); } static now(){ return _clock; } };

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('reconcile — status sync');
  reset();
  cfg.dbOrders = [
    { id: 1, broker_order_id: 'A', status: 'PENDING' },
    { id: 2, broker_order_id: 'B', status: 'PENDING' },
    { id: 3, broker_order_id: 'C', status: 'COMPLETED' }, // shouldn't be in the query set, but ignore if book absent
  ];
  cfg.book = [
    { order_id: 'A', status: 'complete', filled_quantity: 10, average_price: 101.2 }, // PENDING→COMPLETED
    { order_id: 'B', status: 'open',     filled_quantity: 0,  average_price: 0 },      // no change
  ];
  let r = await engine.reconcile(1);
  ok('checked 3 open orders', r.checked === 3, JSON.stringify(r));
  ok('1 transition applied (A→COMPLETED)', r.transitions === 1, JSON.stringify(r));
  ok('persisted UPDATE for order A', cfg.updates.some(u => u.params.includes(1) && u.params.includes('COMPLETED')), JSON.stringify(cfg.updates));
  ok('no UPDATE for unchanged order B', !cfg.updates.some(u => u.params.includes(2)), '');

  console.log('reconcile — illegal transition is refused');
  reset();
  cfg.dbOrders = [{ id: 9, broker_order_id: 'Z', status: 'COMPLETED' }];
  cfg.book = [{ order_id: 'Z', status: 'open' }];   // COMPLETED→open is illegal
  r = await engine.reconcile(1);
  ok('illegal transition counted, not applied', r.illegal === 1 && r.transitions === 0, JSON.stringify(r));
  ok('no UPDATE written', cfg.updates.length === 0, JSON.stringify(cfg.updates));

  console.log('reconcile — broker book unavailable degrades safely');
  reset();
  cfg.dbOrders = [{ id: 1, broker_order_id: 'A', status: 'PENDING' }];
  broker.getOrderBook = async () => { throw new Error('503'); };
  r = await engine.reconcile(1);
  ok('reports broker error, 0 transitions', r.transitions === 0 && /broker/.test(r.error || ''), JSON.stringify(r));
  broker.getOrderBook = async () => cfg.book;   // restore

  console.log('runOnce — guards');
  reset();
  cfg.killSwitch = true;
  ok('kill-switch blocks run', (await engine.runOnce(1)).reason === 'kill-switch');
  reset(); cfg.authed = false;
  ok('unauthenticated broker blocks run', (await engine.runOnce(1)).reason === 'broker-unauthenticated');
  reset(); _clock = CLOSED;
  ok('closed market blocks run', (await engine.runOnce(1)).reason === 'market-closed');
  reset(); _clock = OPEN;
  ok('no userId blocks run', (await engine.runOnce(null)).reason === 'no-user');
  reset(); _clock = OPEN;
  cfg.dbOrders = []; cfg.book = [];
  const good = await engine.runOnce(1);
  ok('clean tick runs + reconciles', good.ran === true && good.reconcile, JSON.stringify(good));

  global.Date = RealDate;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
