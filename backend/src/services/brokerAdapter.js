// src/services/brokerAdapter.js — Upstox broker adapter
// Adapter pattern: swap provider by changing this file only.
'use strict';

const axios      = require('axios');
const upstoxAuth = require('./upstoxAuth');
const db         = require('../config/database');
const logger     = require('../config/logger');

// ── Environment: sandbox vs live ──────────────────────────────────────────────
// UPSTOX_SANDBOX=true routes order-management calls (place/cancel/order-book/
// positions) to Upstox's sandbox host so orders can be tested with ZERO real
// money. Market-data reads always use the live host. When sandbox is on and a
// dedicated UPSTOX_SANDBOX_TOKEN is set, that token is used for order calls.
const SANDBOX      = String(process.env.UPSTOX_SANDBOX || 'false').toLowerCase() === 'true';
const LIVE_BASE    = 'https://api.upstox.com/v2';
const SANDBOX_BASE = process.env.UPSTOX_SANDBOX_BASE || 'https://api-sandbox.upstox.com/v2';
const BASE         = 'https://api.upstox.com/v2';   // market-data / read host (unchanged)
const ORDER_BASE   = SANDBOX ? SANDBOX_BASE : LIVE_BASE;   // order-management host
const TIMEOUT      = 15_000;

// Upstox equity product codes: Delivery=D, Intraday=I. UI exposes CNC/MIS/NRML.
const PRODUCT_MAP = { CNC: 'D', MIS: 'I', NRML: 'D', DELIVERY: 'D', INTRADAY: 'I', D: 'D', I: 'I' };
function _product(p) { return PRODUCT_MAP[String(p || 'CNC').toUpperCase()] || 'D'; }

// Order types passed straight through: MARKET | LIMIT | SL | SL-M
function _orderType(t) {
  const up = String(t || 'MARKET').toUpperCase();
  return ['MARKET', 'LIMIT', 'SL', 'SL-M'].includes(up) ? up : 'MARKET';
}

function isSandbox() { return SANDBOX; }

// ── NSE instrument key helper ─────────────────────────────────────────────────
// Upstox needs "NSE_EQ|INE002A01018" format. We store a simple map for the
// top 50 symbols. For prod, load from Upstox instrument master CSV.
const INSTRUMENT_KEYS = {
  RELIANCE: 'NSE_EQ|INE002A01018', TCS: 'NSE_EQ|INE467B01029',
  INFY: 'NSE_EQ|INE009A01021', HDFCBANK: 'NSE_EQ|INE040A01034',
  ICICIBANK: 'NSE_EQ|INE090A01021', WIPRO: 'NSE_EQ|INE075A01022',
  SBIN: 'NSE_EQ|INE062A01020', AXISBANK: 'NSE_EQ|INE238A01034',
  BAJFINANCE: 'NSE_EQ|INE296A01024', KOTAKBANK: 'NSE_EQ|INE237A01028',
  MARUTI: 'NSE_EQ|INE585B01010', TATAMOTORS: 'NSE_EQ|INE155A01022',
  SUNPHARMA: 'NSE_EQ|INE044A01036', TECHM: 'NSE_EQ|INE669C01036',
  TITAN: 'NSE_EQ|INE280A01028', ULTRACEMCO: 'NSE_EQ|INE481G01011',
  LT: 'NSE_EQ|INE018A01030', HINDUNILVR: 'NSE_EQ|INE030A01027',
  BHARTIARTL: 'NSE_EQ|INE397D01024', HCLTECH: 'NSE_EQ|INE860A01027',
};

function _key(symbol) {
  return INSTRUMENT_KEYS[symbol.toUpperCase()] || `NSE_EQ|${symbol.toUpperCase()}`;
}

function _headers(token) {
  return { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' };
}

// ── Get token for user (DB first, then global) ────────────────────────────────
async function _getToken(userId) {
  if (userId) {
    const [rows] = await db.query(
      `SELECT access_token, token_expiry FROM broker_accounts
       WHERE user_id = ? AND provider = 'upstox' AND is_active = true LIMIT 1`,
      [userId]
    );
    if (rows[0]?.access_token) {
      if (!rows[0].token_expiry || new Date(rows[0].token_expiry) > new Date()) {
        return rows[0].access_token;
      }
    }
  }
  // Fall back to global token
  const t = upstoxAuth.getAccessToken();
  if (!t) throw new Error('Upstox not authenticated. Complete OAuth at /api/auth/upstox/login');
  return t;
}

// Token for ORDER-management calls. In sandbox, prefer a dedicated sandbox
// token if provided; otherwise reuse the normal token.
async function _orderToken(userId) {
  if (SANDBOX && process.env.UPSTOX_SANDBOX_TOKEN) return process.env.UPSTOX_SANDBOX_TOKEN;
  return _getToken(userId);
}

// ── placeOrder ────────────────────────────────────────────────────────────────
// Full parameter set: order_type (MARKET|LIMIT|SL|SL-M), product (CNC|MIS|NRML),
// validity (DAY|IOC), trigger_price, disclosed_quantity, is_amo.
async function placeOrder(userId, {
  symbol, side, qty,
  orderType = 'MARKET', product = 'CNC', validity = 'DAY',
  price = null, triggerPrice = 0, disclosedQty = 0, isAmo = false,
}) {
  const token = await _orderToken(userId);
  const ot    = _orderType(orderType);
  const body  = {
    instrument_token:   _key(symbol),
    transaction_type:   String(side).toUpperCase(),   // BUY | SELL
    quantity:           Number(qty),
    order_type:         ot,                            // MARKET | LIMIT | SL | SL-M
    product:            _product(product),             // D (CNC/NRML) | I (MIS)
    validity:           String(validity).toUpperCase() === 'IOC' ? 'IOC' : 'DAY',
    disclosed_quantity: Number(disclosedQty) || 0,
    trigger_price:      Number(triggerPrice) || 0,
    is_amo:             Boolean(isAmo),
    price:              0,
  };
  // LIMIT / SL need a price; SL / SL-M need a trigger price.
  if ((ot === 'LIMIT' || ot === 'SL') && price != null) body.price = Number(price);
  if ((ot === 'SL' || ot === 'SL-M') && triggerPrice) body.trigger_price = Number(triggerPrice);

  logger.info(`[Broker] placeOrder ${side} ${qty}×${symbol} type=${ot} product=${body.product} amo=${body.is_amo} sandbox=${SANDBOX} user=${userId}`);
  const res = await axios.post(`${ORDER_BASE}/order/place`, body, { headers: _headers(token), timeout: TIMEOUT });
  return res.data;
}

// ── cancelOrder ───────────────────────────────────────────────────────────────
async function cancelOrder(userId, brokerOrderId) {
  const token = await _orderToken(userId);
  const res   = await axios.delete(`${ORDER_BASE}/order/cancel`, {
    headers: _headers(token), timeout: TIMEOUT,
    params: { order_id: brokerOrderId },
  });
  return res.data;
}

// ── getOrderBook ──────────────────────────────────────────────────────────────
async function getOrderBook(userId) {
  const token = await _orderToken(userId);
  const res   = await axios.get(`${ORDER_BASE}/order/retrieve-all`, { headers: _headers(token), timeout: TIMEOUT });
  return res.data?.data || [];
}

// ── getPositions ──────────────────────────────────────────────────────────────
async function getPositions(userId) {
  const token = await _orderToken(userId);
  const res   = await axios.get(`${ORDER_BASE}/portfolio/short-term-positions`, { headers: _headers(token), timeout: TIMEOUT });
  return res.data?.data || [];
}

// ── getCharges ────────────────────────────────────────────────────────────────
// Best-effort brokerage/charges preview via Upstox, with a local fallback
// estimate so the confirmation modal always has numbers to show. NEVER throws —
// returns { source: 'UPSTOX'|'ESTIMATE', ...breakdown }.
async function getCharges(userId, { symbol, side, qty, price, product = 'CNC' }) {
  const quantity = Number(qty) || 0;
  const px       = Number(price) || 0;
  try {
    const token = await _getToken(userId);
    const res = await axios.get(`${BASE}/charges/brokerage`, {
      headers: _headers(token), timeout: TIMEOUT,
      params: {
        instrument_token: _key(symbol),
        quantity,
        product: _product(product),
        transaction_type: String(side).toUpperCase(),
        price: px,
      },
    });
    const c = res.data?.data?.charges || {};
    const t = c.taxes || {};
    return {
      source:        'UPSTOX',
      brokerage:     num(c.brokerage),
      exchange:      num(t.transaction_charge ?? t.exchange_turnover_charge),
      gst:           num(t.gst),
      stt:           num(t.stt),
      sebi:          num(t.sebi_turnover_charge),
      stampDuty:     num(t.stamp_duty),
      total:         num(c.total),
    };
  } catch (_) {
    return { source: 'ESTIMATE', ..._estimateCharges({ side, qty: quantity, price: px, product }) };
  }
}

// Local charge estimate — Indian equity (Upstox-style flat brokerage).
// Delivery (CNC): ₹0 brokerage. Intraday (MIS): ₹20 or 0.05% (whichever lower).
// Figures are APPROXIMATE and for display only — real charges come from Upstox.
function _estimateCharges({ side, qty, price, product }) {
  const value   = qty * price;
  const isSell  = String(side).toUpperCase() === 'SELL';
  const intraday = _product(product) === 'I';

  const brokerage = intraday ? Math.min(20, value * 0.0005) : 0;
  // STT: delivery 0.1% both sides; intraday 0.025% on sell only.
  const stt       = intraday ? (isSell ? value * 0.00025 : 0) : value * 0.001;
  const exchange  = value * 0.0000297;            // NSE ~0.00297%
  const sebi      = value * 0.000001;             // ₹10 per crore
  const stampDuty = isSell ? 0 : value * (intraday ? 0.00003 : 0.00015); // buy side only
  const gst       = (brokerage + exchange + sebi) * 0.18;
  const total     = brokerage + stt + exchange + sebi + stampDuty + gst;

  const r = (n) => Math.round(n * 100) / 100;
  return {
    brokerage: r(brokerage), exchange: r(exchange), gst: r(gst),
    stt: r(stt), sebi: r(sebi), stampDuty: r(stampDuty), total: r(total),
  };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ── getFunds ──────────────────────────────────────────────────────────────────
async function getFunds(userId) {
  const token = await _getToken(userId);
  const res   = await axios.get(`${BASE}/user/get-funds-and-margin`, {
    headers: _headers(token), timeout: TIMEOUT,
    params:  { segment: 'SEC' },
  });
  return res.data?.data || {};
}

// ── getProfile ────────────────────────────────────────────────────────────────
// GET /v2/user/profile → account identity for the Broker Status Card.
// Upstox shape: { user_id, user_name, email, broker, exchanges, products,
// order_types, user_type, is_active }.
async function getProfile(userId) {
  const token = await _getToken(userId);
  const res   = await axios.get(`${BASE}/user/profile`, {
    headers: _headers(token), timeout: TIMEOUT,
  });
  return res.data?.data || {};
}

module.exports = {
  placeOrder, cancelOrder, getOrderBook, getPositions, getFunds, getProfile, getCharges,
  isSandbox,
};
