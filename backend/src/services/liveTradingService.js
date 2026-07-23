// src/services/liveTradingService.js
// Orchestrates LIVE (real-money) order placement with full safety checks.
'use strict';

const db         = require('../config/database');
const broker     = require('./brokerAdapter');
const logger     = require('../config/logger');
const riskLimits = require('../risk/riskLimits');
const executionQuality = require('./executionQuality');

const _n = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

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

// Best-effort store of the expected (reference) price for slippage tracking.
// Guarded: a missing column (pre-migration) is ignored, never breaks the order.
async function _setExpectedPrice(orderId, expectedPrice) {
  if (orderId == null || !(Number(expectedPrice) > 0)) return;
  try {
    await db.query('UPDATE live_orders SET expected_price = ? WHERE id = ?', [Number(expectedPrice), orderId]);
  } catch (e) {
    if (!/unknown column|no column|1054/i.test(e.message)) logger.debug(`[LiveTrading] expected_price: ${e.message}`);
  }
}

// ── Save order to DB ──────────────────────────────────────────────────────────
// Tries the full (Phase 2) column set first; if the migration hasn't been run
// yet the DB rejects the unknown columns and we fall back to the base insert so
// nothing breaks pre-migration.
async function _saveOrder(data) {
  const _id = await _insertOrder(data);
  await _setExpectedPrice(_id, data.expectedPrice);
  return _id;
}

async function _insertOrder(data) {
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

// Current open exposure (₹) and aggregate P&L (₹) from live broker positions.
// Used by the daily-loss and max-exposure pre-trade checks.
async function _riskSnapshot(userId) {
  const positions = await getPositions(userId);
  let exposure = 0, pnl = 0;
  for (const p of positions) {
    const px = _n(p.ltp) || _n(p.avgPrice);
    exposure += Math.abs(_n(p.qty)) * px;
    pnl      += _n(p.overallPnl);
  }
  return { exposure, pnl };
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

  // 6b. Configurable risk limits (Phase 3): max position size + max orders/day.
  const limits = await riskLimits.getLimits();
  if (limits.maxPositionSize && estValue > limits.maxPositionSize) {
    throw Object.assign(
      new Error(`Order value ₹${estValue.toLocaleString('en-IN')} exceeds max position size ₹${limits.maxPositionSize.toLocaleString('en-IN')}`),
      { code: 'MAX_POSITION_SIZE', statusCode: 400 }
    );
  }
  if (limits.maxOrdersPerDay) {
    const [cntRows] = await db.query(
      `SELECT COUNT(*) AS c FROM live_orders
       WHERE user_id = ? AND status NOT IN ('REJECTED')
         AND created_at >= CURRENT_DATE`,
      [userId]
    ).catch(() => [[{ c: 0 }]]);
    const todayCount = _n(cntRows?.[0]?.c);
    if (todayCount >= limits.maxOrdersPerDay) {
      throw Object.assign(
        new Error(`Daily order limit reached (${limits.maxOrdersPerDay})`),
        { code: 'MAX_ORDERS', statusCode: 429 }
      );
    }
  }

  // 6c. Live P&L / exposure limits (Phase 3, hard-enforced). Reads current
  // broker positions. Best-effort: a transient broker read error does NOT block
  // trading (the kill switch is the hard stop), but a successful read that
  // breaches a limit rejects the order.
  if (limits.dailyLossLimit || limits.maxExposure) {
    try {
      const snap = await _riskSnapshot(userId);
      // Daily loss: if we're already down more than the limit, block new risk.
      if (limits.dailyLossLimit && snap.pnl < 0 && Math.abs(snap.pnl) >= limits.dailyLossLimit) {
        throw Object.assign(
          new Error(`Daily loss limit hit: P&L ₹${snap.pnl.toLocaleString('en-IN')} breaches limit ₹${limits.dailyLossLimit.toLocaleString('en-IN')}`),
          { code: 'DAILY_LOSS_LIMIT', statusCode: 403 }
        );
      }
      // Max exposure: current open exposure + this order must stay within cap.
      if (limits.maxExposure && (snap.exposure + estValue) > limits.maxExposure) {
        throw Object.assign(
          new Error(`Exposure ₹${(snap.exposure + estValue).toLocaleString('en-IN')} would exceed max exposure ₹${limits.maxExposure.toLocaleString('en-IN')}`),
          { code: 'MAX_EXPOSURE', statusCode: 403 }
        );
      }
    } catch (err) {
      if (err.code === 'DAILY_LOSS_LIMIT' || err.code === 'MAX_EXPOSURE') throw err;
      logger.warn(`[LiveTrading] risk snapshot unavailable — skipping P&L/exposure check: ${err.message}`);
    }
  }

  // 7. Place order via broker
  // expectedPrice = reference price at submit time (LTP for market, limit price
  // otherwise) — used later to measure slippage vs the actual fill.
  const expectedPrice = (ot === 'LIMIT' || ot === 'SL') ? Number(price) || Number(currentPrice) || 0
                                                        : Number(currentPrice) || Number(price) || 0;
  const orderMeta = { orderType: ot, product, validity, triggerPrice, disclosedQty, isAmo, sandbox, expectedPrice };
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
// Normalize Upstox short-term positions → the fields the Positions UI needs.
async function getPositions(userId) {
  const raw = await broker.getPositions(userId);
  return (raw || []).map(p => {
    const qty      = _n(p.quantity ?? p.net_quantity ?? p.day_buy_quantity - p.day_sell_quantity);
    const avg      = _n(p.average_price ?? p.buy_price ?? p.average_buy_price);
    const ltp      = _n(p.last_price ?? p.ltp);
    const dayPnl   = _n(p.day_pnl ?? p.pnl);
    const realized = _n(p.realised ?? p.realized);
    const unreal   = _n(p.unrealised ?? p.unrealized);
    return {
      symbol:       p.tradingsymbol || p.trading_symbol || p.symbol,
      instrument:   p.instrument_token || null,
      product:      p.product || null,
      exchange:     p.exchange || 'NSE',
      qty,
      avgPrice:     avg,
      ltp,
      dayPnl,
      overallPnl:   realized + unreal || _n(p.pnl),
      mtm:          unreal || (ltp && avg ? (ltp - avg) * qty : 0),
      positionId:   p.instrument_token || p.tradingsymbol || null,
      raw:          p,
    };
  });
}

// Normalize funds → cash / used margin / collateral / buying power / opening balance.
async function getFundsNormalized(userId) {
  const raw = await broker.getFunds(userId);
  const eq  = raw?.equity || raw || {};
  const available = _n(eq.available_margin);
  const used      = _n(eq.used_margin);
  return {
    availableCash:  available,
    usedMargin:     used,
    collateral:     _n(eq.collateral),
    buyingPower:    available,                 // cash available to deploy
    openingBalance: _n(eq.opening_balance ?? (available + used)),
    raw:            eq,
  };
}

// Holdings → invested / current value / today's & total gain, allocation, sector.
async function getHoldings(userId) {
  const raw = await broker.getHoldings(userId);
  const holdings = (raw || []).map(h => {
    const qty      = _n(h.quantity);
    const avg      = _n(h.average_price);
    const ltp      = _n(h.last_price ?? h.ltp);
    const close    = _n(h.close_price ?? h.day_change_close ?? ltp);
    const invested = qty * avg;
    const current  = qty * ltp;
    return {
      symbol:      h.tradingsymbol || h.trading_symbol,
      qty, avgPrice: avg, ltp,
      invested, currentValue: current,
      totalGain:   current - invested,
      todayGain:   qty * (ltp - close),
      sector:      h.sector || 'Other',
    };
  });
  const invested     = holdings.reduce((s, h) => s + h.invested, 0);
  const currentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const todayGain    = holdings.reduce((s, h) => s + h.todayGain, 0);
  const bySector = {};
  for (const h of holdings) bySector[h.sector] = (bySector[h.sector] || 0) + h.currentValue;
  return {
    holdings,
    summary: {
      invested, currentValue, todayGain,
      totalGain: currentValue - invested,
      allocation: holdings.map(h => ({ symbol: h.symbol, value: h.currentValue, pct: currentValue ? h.currentValue / currentValue * 100 : 0 })),
      sectorAllocation: Object.entries(bySector).map(([sector, value]) => ({ sector, value, pct: currentValue ? value / currentValue * 100 : 0 })),
    },
  };
}

// ── Exit / emergency ──────────────────────────────────────────────────────────
// Square off a single position with a market order in the opposite direction.
async function exitPosition(userId, symbol) {
  const positions = await getPositions(userId);
  const pos = positions.find(p => String(p.symbol).toUpperCase() === String(symbol).toUpperCase() && p.qty !== 0);
  if (!pos) throw Object.assign(new Error(`No open position for ${symbol}`), { statusCode: 404, code: 'NO_POSITION' });
  const side = pos.qty > 0 ? 'SELL' : 'BUY';
  return placeOrder(userId, {
    symbol: pos.symbol, side, qty: Math.abs(pos.qty),
    orderType: 'MARKET', product: pos.product === 'I' ? 'MIS' : 'CNC',
    confirmed: true, currentPrice: pos.ltp,
  });
}

// Exit ALL open positions (square-off all).
async function squareOffAll(userId) {
  const positions = (await getPositions(userId)).filter(p => p.qty !== 0);
  const results = [];
  for (const p of positions) {
    try { results.push({ symbol: p.symbol, ...(await exitPosition(userId, p.symbol)) }); }
    catch (err) { results.push({ symbol: p.symbol, success: false, error: err.message }); }
  }
  return { squaredOff: results.length, results };
}

// Cancel ALL open orders.
async function cancelAllOrders(userId) {
  const book = await broker.getOrderBook(userId).catch(() => []);
  const open = book.filter(o => /open|trigger|pending|validation/i.test(o.status || ''));
  const results = [];
  for (const o of open) {
    try { await broker.cancelOrder(userId, o.order_id); results.push({ orderId: o.order_id, success: true }); }
    catch (err) { results.push({ orderId: o.order_id, success: false, error: err.message }); }
  }
  return { cancelled: results.filter(r => r.success).length, attempted: open.length, results };
}

// ── Risk config ───────────────────────────────────────────────────────────────
async function getRiskLimits()      { return riskLimits.getLimits(); }
async function setRiskLimits(patch) { return riskLimits.setLimits(patch); }
async function isKillSwitchEngaged() { return !(await _isLiveTradingEnabled()); }

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

// ── Execution quality (slippage) ──────────────────────────────────────────────
// Reconcile filled orders: pull actual fills from the broker book and persist
// avg_price + slippage_bps vs the expected price we stored at submit time.
async function reconcileFills(userId) {
  let orders = [];
  try { orders = await getOrders(userId); } catch (e) { logger.debug(`[ExecQuality] getOrders: ${e.message}`); return { updated: 0 }; }
  let updated = 0;
  for (const o of orders) {
    if (!(Number(o.avgPrice) > 0)) continue;
    if (!['COMPLETED', 'PARTIAL'].includes(o.status)) continue;
    let expected = 0;
    try {
      const [rows] = await db.query('SELECT expected_price FROM live_orders WHERE id = ?', [o.id]);
      expected = Number(rows?.[0]?.expected_price);
    } catch (_) { continue; }   // pre-migration
    if (!(expected > 0)) continue;
    const s = executionQuality.computeSlippage({ side: o.side, expectedPrice: expected, fillPrice: o.avgPrice });
    if (!s) continue;
    try {
      await db.query('UPDATE live_orders SET avg_price = ?, filled_qty = ?, slippage_bps = ? WHERE id = ?',
        [Number(o.avgPrice), o.filledQty ?? null, s.slippageBps, o.id]);
      updated++;
    } catch (e) { if (!/unknown column|1054/i.test(e.message)) logger.debug(`[ExecQuality] persist: ${e.message}`); }
  }
  return { updated };
}

// Aggregate execution quality + a measured slippage estimate for backtests.
async function getExecutionQuality(userId) {
  let rows = [];
  try {
    [rows] = await db.query(
      `SELECT symbol, side, qty, expected_price, avg_price
       FROM live_orders
       WHERE user_id = ? AND expected_price IS NOT NULL AND avg_price IS NOT NULL AND avg_price > 0
       ORDER BY created_at DESC LIMIT 500`, [userId]);
  } catch (_) { rows = []; }   // columns missing → empty summary
  const orders = rows.map(r => ({
    symbol: r.symbol, side: r.side, qty: r.qty,
    expectedPrice: Number(r.expected_price), fillPrice: Number(r.avg_price),
  }));
  const summary = executionQuality.aggregate(orders);
  return { ...summary, suggestedBacktestSlippagePct: executionQuality.estimateBacktestSlippagePct(summary) };
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

module.exports = {
  placeOrder, getCharges, getPositions, getOrders, getFunds, getFundsNormalized,
  getHoldings, cancelOrder, setKillSwitch, isKillSwitchEngaged,
  exitPosition, squareOffAll, cancelAllOrders,
  getRiskLimits, setRiskLimits,
  reconcileFills, getExecutionQuality,
};
