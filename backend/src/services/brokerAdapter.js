// src/services/brokerAdapter.js — Upstox broker adapter
// Adapter pattern: swap provider by changing this file only.
'use strict';

const axios      = require('axios');
const upstoxAuth = require('./upstoxAuth');
const db         = require('../config/database');
const logger     = require('../config/logger');

const BASE     = 'https://api.upstox.com/v2';
const TIMEOUT  = 15_000;

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

// ── placeOrder ────────────────────────────────────────────────────────────────
async function placeOrder(userId, { symbol, side, qty, orderType = 'MARKET', price = null }) {
  const token = await _getToken(userId);
  const body  = {
    instrument_token: _key(symbol),
    transaction_type: side.toUpperCase(),         // BUY | SELL
    quantity:         qty,
    order_type:       orderType.toUpperCase(),     // MARKET | LIMIT
    product:          'D',                         // Delivery (CNC)
    validity:         'DAY',
    disclosed_quantity: 0,
    trigger_price:    0,
    is_amo:           false,
  };
  if (orderType === 'LIMIT' && price) body.price = price;

  logger.info(`[Broker] placeOrder ${side} ${qty}×${symbol} type=${orderType} user=${userId}`);
  const res = await axios.post(`${BASE}/order/place`, body, { headers: _headers(token), timeout: TIMEOUT });
  return res.data;
}

// ── cancelOrder ───────────────────────────────────────────────────────────────
async function cancelOrder(userId, brokerOrderId) {
  const token = await _getToken(userId);
  const res   = await axios.delete(`${BASE}/order/cancel`, {
    headers: _headers(token), timeout: TIMEOUT,
    params: { order_id: brokerOrderId },
  });
  return res.data;
}

// ── getOrderBook ──────────────────────────────────────────────────────────────
async function getOrderBook(userId) {
  const token = await _getToken(userId);
  const res   = await axios.get(`${BASE}/order/retrieve-all`, { headers: _headers(token), timeout: TIMEOUT });
  return res.data?.data || [];
}

// ── getPositions ──────────────────────────────────────────────────────────────
async function getPositions(userId) {
  const token = await _getToken(userId);
  const res   = await axios.get(`${BASE}/portfolio/short-term-positions`, { headers: _headers(token), timeout: TIMEOUT });
  return res.data?.data || [];
}

// ── getFunds ──────────────────────────────────────────────────────────────────
async function getFunds(userId) {
  const token = await _getToken(userId);
  const res   = await axios.get(`${BASE}/user/get-funds-and-margin`, {
    headers: _headers(token), timeout: TIMEOUT,
    params:  { segment: 'SEC' },
  });
  return res.data?.data || {};
}

module.exports = { placeOrder, cancelOrder, getOrderBook, getPositions, getFunds };
