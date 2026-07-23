// scripts/test-live-order-risk.js
// Offline test of the LIVE order safety gauntlet in liveTradingService.placeOrder.
// Stubs DB, broker, and the clock — no network, no real money. Proves every
// pre-trade guard rejects with the right code, and that a clean order places.
//   node scripts/test-live-order-risk.js
'use strict';

// ── Fake clock: default to a weekday market-open time (Mon 10:00 IST). ─────────
const OPEN   = Date.UTC(2025, 0, 6, 4, 30, 0);   // Mon 2025-01-06 04:30 UTC = 10:00 IST
const CLOSED = Date.UTC(2025, 0, 6, 1, 0, 0);    // Mon 06:30 IST (pre-open)
let _clock = OPEN;
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { a.length ? super(...a) : super(_clock); }
  static now() { return _clock; }
};

// ── Quiet logging ─────────────────────────────────────────────────────────────
const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.error = () => {}; logger.debug = () => {};

// ── Stub db + broker BEFORE using the service (same module instances). ─────────
const db     = require('../src/config/database');
const broker = require('../src/services/brokerAdapter');

// Per-test config controlling stub responses.
let cfg;
function resetCfg() {
  cfg = { killSwitch: false, duplicate: false, todayCount: 0, limitRows: [], positions: [] };
  _clock = OPEN;
}

db.query = async (sql) => {
  const s = String(sql);
  if (s.includes("'live_trading_enabled'"))                 return [[{ flag_value: cfg.killSwitch ? 'false' : 'true' }]];
  if (s.includes('flag_key IN'))                            return [cfg.limitRows];                 // riskLimits.getLimits
  if (s.includes('SELECT id FROM live_orders'))             return [cfg.duplicate ? [{ id: 1 }] : []]; // _isDuplicate
  if (s.includes('COUNT(*)'))                               return [[{ c: cfg.todayCount }]];        // maxOrdersPerDay
  if (s.trim().toUpperCase().startsWith('INSERT'))          return [null, { insertId: 42 }];         // _saveOrder
  return [[]];
};
broker.isSandbox   = () => true;
broker.getPositions = async () => cfg.positions;
broker.placeOrder  = async () => ({ order_id: 'TEST123' });

const lts = require('../src/services/liveTradingService');

// ── Test helpers ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(name, cond, extra = '') { cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name} ${extra}`)); }

const VALID = { symbol: 'RELIANCE', side: 'BUY', qty: 1, orderType: 'MARKET', currentPrice: 100, confirmed: true };

async function expectReject(name, params, code, tweak = () => {}) {
  resetCfg(); tweak();
  try { await lts.placeOrder(1, { ...VALID, ...params }); ok(name, false, '→ did NOT throw'); }
  catch (e) { ok(name, e.code === code, `→ got ${e.code} (${e.message})`); }
}

(async () => {
  console.log('placeOrder — input validation');
  await expectReject('bad order type → BAD_ORDER_TYPE',      { orderType: 'FOO' },              'BAD_ORDER_TYPE');
  await expectReject('LIMIT without price → PRICE_REQUIRED', { orderType: 'LIMIT', price: 0 },  'PRICE_REQUIRED');
  await expectReject('SL-M without trigger → TRIGGER_REQUIRED', { orderType: 'SL-M' },          'TRIGGER_REQUIRED');
  await expectReject('qty 0 → BAD_QTY',                      { qty: 0 },                        'BAD_QTY');
  await expectReject('unconfirmed → CONFIRMATION_REQUIRED',  { confirmed: false },              'CONFIRMATION_REQUIRED');

  console.log('placeOrder — safety guards');
  await expectReject('kill switch → KILL_SWITCH',    {},            'KILL_SWITCH',   () => { cfg.killSwitch = true; });
  await expectReject('market closed → MARKET_CLOSED', {},           'MARKET_CLOSED', () => { _clock = CLOSED; });
  await expectReject('qty > max → QTY_LIMIT',        { qty: 600 },  'QTY_LIMIT');
  await expectReject('value > max → VALUE_LIMIT',    { qty: 100, currentPrice: 6000 }, 'VALUE_LIMIT');
  await expectReject('duplicate → DUPLICATE',        {},            'DUPLICATE',     () => { cfg.duplicate = true; });

  console.log('placeOrder — configurable risk limits');
  await expectReject('over max position size → MAX_POSITION_SIZE', { qty: 1, currentPrice: 100 }, 'MAX_POSITION_SIZE',
    () => { cfg.limitRows = [{ flag_key: 'risk.max_position_size', flag_value: '50' }]; });
  await expectReject('daily order cap → MAX_ORDERS', {}, 'MAX_ORDERS',
    () => { cfg.limitRows = [{ flag_key: 'risk.max_orders_per_day', flag_value: '1' }]; cfg.todayCount = 5; });
  await expectReject('over max exposure → MAX_EXPOSURE', { qty: 1, currentPrice: 100 }, 'MAX_EXPOSURE',
    () => { cfg.limitRows = [{ flag_key: 'risk.max_exposure', flag_value: '50' }]; });
  await expectReject('daily loss breached → DAILY_LOSS_LIMIT', {}, 'DAILY_LOSS_LIMIT',
    () => { cfg.positions = [{ quantity: 1, average_price: 100, last_price: 100, pnl: -30000 }]; });

  console.log('placeOrder — clean order places');
  resetCfg();
  try {
    const r = await lts.placeOrder(1, { ...VALID });
    ok('valid order returns success', r.success === true && r.status === 'PLACED', JSON.stringify(r));
    ok('carries broker order id', r.brokerOrderId === 'TEST123', r.brokerOrderId);
    ok('flagged sandbox', r.sandbox === true);
  } catch (e) { ok('valid order returns success', false, `threw ${e.code}: ${e.message}`); }

  console.log(`\n${pass} passed, ${fail} failed`);
  global.Date = RealDate;
  process.exit(fail ? 1 : 0);
})();
