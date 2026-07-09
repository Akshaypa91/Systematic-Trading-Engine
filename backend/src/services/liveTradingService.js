// src/services/liveTradingService.js
// Orchestrates LIVE (real-money) order placement with full safety checks.
'use strict';

const db      = require('../config/database');
const broker  = require('./brokerAdapter');
const logger  = require('../config/logger');

// ── Risk limits (override via env) ────────────────────────────────────────────
const MAX_QTY        = parseInt(process.env.LIVE_MAX_QTY        || '500',        10);
const MAX_ORDER_VAL  = parseFloat(process.env.LIVE_MAX_ORDER_VAL || '500000');    // ₹5L
const MIN_CONFIRM    = true;   // always require confirmed: true in request

// ── Market hours (IST) ────────────────────────────────────────────────────────
function _isMarketOpen() {
  const now  = new Date();
  const ist  = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day  = ist.getUTCDay();                     // 0=Sun 6=Sat
  const hhmm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && hhmm >= 915 && hhmm <= 1530;
}

// ── Kill-switch check ─────────────────────────────────────────────────────────
async function _isLiveTradingEnabled() {
  try {
    const [rows] = await db.query(
      "SELECT flag_value FROM system_flags WHERE flag_key = 'live_trading_enabled' LIMIT 1"
    );
    return rows[0]?.flag_value !== 'false';
  } catch { return true; }  // fail open if table missing
}

// ── Duplicate order guard (same user+symbol+side within 10s) ─────────────────
async function _isDuplicate(userId, symbol, side) {
  // INTERVAL '10 seconds' is Postgres syntax — MySQL/TiDB uses INTERVAL 10 SECOND.
  const [rows] = await db.query(
    `SELECT id FROM live_orders
     WHERE user_id = ? AND symbol = ? AND side = ?
       AND status NOT IN ('REJECTED','CANCELLED')
       AND created_at > CURRENT_TIMESTAMP - INTERVAL 10 SECOND
     LIMIT 1`,
    [userId, symbol, side]
  );
  return rows.length > 0;
}

// ── Save order to DB ──────────────────────────────────────────────────────────
// Tries the full (Phase 2) column set first; if the migration hasn't been run
// yet the DB rejects the unknown columns and we fall back to the base insert so
// nothing breaks pre-migration.
async function _saveOrder(data) {
  try {
    const [, r] = await db.query(
      `INSERT INTO live_orders
         (user_id, broker_order_id, symbol, side, qty, price, trigger_price, order_type,
          product, validity, is_amo, disclosed_qty, status, provider, sandbox,
          raw_response, error_message, confirmed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.userId, data.brokerOrderId || null,
        data.symbol, data.side, data.qty,
        data.price || null, data.triggerPrice || null,
        data.orderType || 'MARKET',
        data.product || 'CNC', data.validity || 'DAY',
        Boolean(data.isAmo), data.disclosedQty || 0,
        data.status, data.provider || 'upstox', Boolean(data.sandbox),
        data.rawResponse ? JSON.stringify(data.rawResponse) : null,
        data.errorMessage || null, Boolean(data.confirmed),
      ]
    );
    return r.insertId;
  } catch (err) {
    if (!/unknown column|no column|1054/i.test(err.message)) throw err;
    logger.warn('[LiveTrading] live_orders Phase 2 columns missing — run migrate-live-orders-phase2.sql. Using base insert.');
    const [, r] = await db.query(
      `INSERT INTO live_orders
         (user_id, broker_order_id, symbol, side, qty, price, order_type,
          status, provider, raw_response, error_message, confirmed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.userId, data.brokerOrderId || null,
        data.symbol, data.side, data.qty, data.price || null,
        data.orderType || 'MARKET', data.status, data.provider || 'upstox',
        data.rawResponse ? JSON.stringify(data.rawResponse) : null,
        data.errorMessage || null, Boolean(data.confirmed),
      ]
    );
    return r.insertId;
  }
}

// ── Main: placeOrder ──────────────────────────────────────────────────────────
/**
 * Place a LIVE order with full safety checks.
 * @param {number} userId
 * @param {{ symbol, side, qty, price?, orderType?, confirmed, currentPrice }} params
 */
async function placeOrder(userId, params) {
  const {
    symbol, side, qty, price = null, orderType = 'MARKET',
    product = 'CNC', validity = 'DAY', triggerPrice = 0, disclosedQty = 0, isAmo = false,
    confirmed = false, currentPrice = 0,
  } = params;
  const sym = String(symbol || '').toUpperCase();
  const sandbox = broker.isSandbox?.() || false;

  // 0. Basic validation of order-type dependent fields
  const ot = String(orderType).toUpperCase();
  if (!['MARKET', 'LIMIT', 'SL', 'SL-M'].includes(ot)) {
    throw Object.assign(new Error(`Invalid order type ${orderType}`), { code: 'BAD_ORDER_TYPE', statusCode: 400 });
  }
  if ((ot === 'LIMIT' || ot === 'SL') && !(Number(price) > 0)) {
    throw Object.assign(new Error(`${ot} order requires a price`), { code: 'PRICE_REQUIRED', statusCode: 400 });
  }
  if ((ot === 'SL' || ot === 'SL-M') && !(Number(triggerPrice) > 0)) {
    throw Object.assign(new Error(`${ot} order requires a trigger price`), { code: 'TRIGGER_REQUIRED', statusCode: 400 });
  }
  if (!(Number(qty) > 0)) {
    throw Object.assign(new Error('Quantity must be greater than 0'), { code: 'BAD_QTY', statusCode: 400 });
  }

  // 1. Explicit confirmation required
  if (MIN_CONFIRM && !confirmed) {
    throw Object.assign(new Error('Live order requires confirmed: true'), { code: 'CONFIRMATION_REQUIRED', statusCode: 400 });
  }

  // 2. Kill switch
  if (!(await _isLiveTradingEnabled())) {
    throw Object.assign(new Error('Live trading is currently disabled by admin'), { code: 'KILL_SWITCH', statusCode: 503 });
  }

  // 3. Market hours
  if (!_isMarketOpen()) {
    throw Object.assign(new Error('NSE market is closed. Orders accepted 9:15–15:30 IST, Mon–Fri'), { code: 'MARKET_CLOSED', statusCode: 400 });
  }

  // 4. Quantity limit
  if (qty > MAX_QTY) {
    throw Object.assign(new Error(`Quantity ${qty} exceeds max allowed ${MAX_QTY}`), { code: 'QTY_LIMIT', statusCode: 400 });
  }

  // 5. Order value limit
  const estValue = qty * (currentPrice || price || 0);
  if (estValue > MAX_ORDER_VAL) {
    throw Object.assign(
      new Error(`Order value ₹${estValue.toLocaleString('en-IN')} exceeds limit ₹${MAX_ORDER_VAL.toLocaleString('en-IN')}`),
      { code: 'VALUE_LIMIT', statusCode: 400 }
    );
  }

  // 6. Duplicate guard
  if (await _isDuplicate(userId, sym, side)) {
    throw Object.assign(new Error(`Duplicate ${side} order for ${sym} within 10s`), { code: 'DUPLICATE', statusCode: 409 });
  }

  // 7. Place order via broker
  const orderMeta = { orderType: ot, product, validity, triggerPrice, disclosedQty, isAmo, sandbox };
  let brokerResponse, brokerOrderId, status, errorMessage;
  try {
    logger.info(`[LiveTrading] Placing LIVE ${side} ${qty}×${sym} type=${ot} product=${product} sandbox=${sandbox} user=${userId}`);
    brokerResponse  = await broker.placeOrder(userId, { symbol: sym, side, qty, orderType: ot, product, validity, price, triggerPrice, disclosedQty, isAmo });
    brokerOrderId   = brokerResponse?.data?.order_id || brokerResponse?.order_id || null;
    status          = 'PLACED';
    logger.info(`[LiveTrading] ✅ Order placed broker_id=${brokerOrderId}`);
  } catch (err) {
    status       = 'REJECTED';
    errorMessage = err.response?.data?.message || err.response?.data?.errors?.[0]?.message || err.message;
    logger.error(`[LiveTrading] ❌ Broker rejected: ${errorMessage}`);
    await _saveOrder({ userId, symbol: sym, side, qty, price, status,
      rawResponse: err.response?.data, errorMessage, confirmed, ...orderMeta });
    throw Object.assign(new Error(`Broker rejected order: ${errorMessage}`), { statusCode: 400, code: 'BROKER_REJECTED' });
  }

  // 8. Save successful order
  const orderId = await _saveOrder({
    userId, brokerOrderId, symbol: sym, side, qty, price,
    status, rawResponse: brokerResponse, confirmed, ...orderMeta,
  });

  return {
    success:       true,
    orderId,
    brokerOrderId,
    symbol:        sym, side, qty, status,
    orderType:     ot, product, validity, isAmo,
    mode:          'LIVE',
    sandbox,
    message:       `${side} ${ot} order ${sandbox ? '(SANDBOX) ' : ''}placed for ${qty}×${sym}`,
  };
}

// ── Charges preview ───────────────────────────────────────────────────────────
async function getCharges(userId, params) {
  return broker.getCharges(userId, params);
}

// ── Read-only sync ────────────────────────────────────────────────────────────
async function getPositions(userId) {
  return broker.getPositions(userId);
}

// Normalized status buckets for the Live Order Book UI.
function _normStatus(s) {
  const up = String(s || '').toLowerCase();
  if (up.includes('reject'))   return 'REJECTED';
  if (up.includes('cancel'))   return 'CANCELLED';
  if (up.includes('complete') || up === 'filled') return 'COMPLETED';
  if (up.includes('partial'))  return 'PARTIAL';
  if (up.includes('open') || up.includes('trigger') || up.includes('pending') || up.includes('placed') || up.includes('validation')) return 'PENDING';
  return String(s || 'PENDING').toUpperCase();
}

// Merge live broker order book (source of truth for fills) with our DB audit
// rows. Falls back to DB-only if the broker call fails.
async function getOrders(userId) {
  const [dbOrders] = await db.query(
    `SELECT id, broker_order_id, symbol, side, qty, price, trigger_price, order_type,
            product, validity, status, sandbox, created_at
     FROM live_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [userId]
  ).catch(async () => db.query(
    `SELECT id, broker_order_id, symbol, side, qty, price, order_type, status, created_at
     FROM live_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [userId]
  ));

  let brokerBook = [];
  try { brokerBook = await broker.getOrderBook(userId); } catch (_) { /* DB-only fallback */ }
  const byId = new Map(brokerBook.map(o => [o.order_id, o]));

  return dbOrders.map(o => {
    const b = o.broker_order_id ? byId.get(o.broker_order_id) : null;
    return {
      id:            o.id,
      brokerOrderId: o.broker_order_id,
      symbol:        o.symbol,
      side:          o.side,
      qty:           o.qty,
      price:         o.price,
      triggerPrice:  o.trigger_price ?? null,
      orderType:     o.order_type,
      product:       o.product ?? null,
      validity:      o.validity ?? null,
      sandbox:       !!o.sandbox,
      status:        _normStatus(b?.status || o.status),
      filledQty:     b?.filled_quantity ?? null,
      avgPrice:      b?.average_price ?? null,
      exchange:      b?.exchange ?? null,
      exchangeTime:  b?.exchange_timestamp ?? b?.order_timestamp ?? null,
      createdAt:     o.created_at,
    };
  });
}

async function getFunds(userId) {
  return broker.getFunds(userId);
}

async function cancelOrder(userId, brokerOrderId) {
  const result = await broker.cancelOrder(userId, brokerOrderId);
  await db.query(
    `UPDATE live_orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND broker_order_id = ?`,
    [userId, brokerOrderId]
  );
  return result;
}

// ── Admin: kill switch ────────────────────────────────────────────────────────
async function setKillSwitch(enabled) {
  // flag_key is the PRIMARY KEY on system_flags, so this upserts on that
  // collision (equivalent to the old ON CONFLICT (flag_key) DO UPDATE).
  await db.query(
    `INSERT INTO system_flags (flag_key, flag_value, updated_at)
     VALUES ('live_trading_enabled', ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       flag_value = VALUES(flag_value),
       updated_at = CURRENT_TIMESTAMP`,
    [enabled ? 'true' : 'false']
  );
}

module.exports = { placeOrder, getCharges, getPositions, getOrders, getFunds, cancelOrder, setKillSwitch };
