// src/ws/upstoxWS.js — V3 real-time feed (authorize handshake + protobuf)
// ─────────────────────────────────────────────────────────────────────────────
// The Upstox v2/v3 market-data WebSocket is NOT a plain authenticated socket:
//   1. GET  /v3/feed/market-data-feed/authorize  (Bearer token) → a one-time
//      `authorized_redirect_uri` (wss://...) that already carries auth.
//   2. Connect the WS to that redirect URI (no auth header).
//   3. Send the subscription as a BINARY frame (Buffer of JSON).
//   4. Incoming frames are BINARY protobuf (FeedResponse) — decode via
//      upstoxProto. The previous build connected directly and skipped binary,
//      which is why it never streamed ("WebSocket: Down").
//
// SAFETY: gated behind UPSTOX_WS_ENABLED (default OFF). While off, connect() is a
// no-op so the reliable REST poller (upstoxRestFeed) stays the price source and
// a not-yet-live-verified protobuf schema can never feed wrong prices into the
// WS cache tier. Flip UPSTOX_WS_ENABLED=true only after confirming a live tick.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const WebSocket    = require('ws');
const axios        = require('axios');
const upstoxAuth   = require('../services/upstoxAuth');
const liveDataFeed = require('../data/liveDataFeed');
const upstoxProto  = require('./upstoxProto');
const symbols      = require('../config/symbols');
const logger       = require('../config/logger');

const AUTHORIZE_URL  = 'https://api.upstox.com/v3/feed/market-data-feed/authorize';
const SUB_MODE       = process.env.UPSTOX_WS_MODE || 'ltpc';   // ltpc | full | full_d30 | option_greeks
const WS_ENABLED     = process.env.UPSTOX_WS_ENABLED === 'true';
const RECONNECT_BASE = 5_000;
const MAX_RECONNECTS = 20;
const PING_INTERVAL  = 30_000;

let _ws             = null;
let _connected      = false;
let _reconnectCount = 0;
let _reconnectTimer = null;
let _pingTimer      = null;
let _subscribedKeys = [];
let _destroyed      = false;  // set on explicit disconnect — stop reconnecting

// ── Tick metrics (for the diagnostics panel) ──────────────────────────────────
let _tickCount      = 0;          // total ticks since boot
let _lastTickTs     = null;       // ISO string of the most recent tick
let _connectedAt    = null;       // when the socket last opened
const _tickWindow   = [];         // recent tick epoch-ms, for a rolling ticks/sec

function _recordTick() {
  _tickCount++;
  const now = Date.now();
  _lastTickTs = new Date(now).toISOString();
  _tickWindow.push(now);
  // keep only the last 5s of timestamps
  const cutoff = now - 5000;
  while (_tickWindow.length && _tickWindow[0] < cutoff) _tickWindow.shift();
}
function _tickRate() { return Math.round((_tickWindow.length / 5) * 10) / 10; }  // ticks/sec over 5s

const _priceCache   = new Map();  // instrumentKey → { price, ts }

// ── Price cache API ───────────────────────────────────────────────────────────

function getCachedPrice(baseSymbol) {
  const key   = symbols.toUpstox(baseSymbol);
  if (!key) return null;
  const entry = _priceCache.get(key);
  if (!entry) return null;
  // Stale after 60s — consider WS dead
  if (Date.now() - entry.rawTs > 60_000) return null;
  return { price: entry.price, source: 'LIVE_UPSTOX', timestamp: entry.ts };
}

// ── Connect ───────────────────────────────────────────────────────────────────

// Step 1: exchange the Bearer token for a one-time authorized wss URI.
async function _authorize(token) {
  const res = await axios.get(AUTHORIZE_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 15_000,
  });
  const uri = res.data?.data?.authorized_redirect_uri || res.data?.data?.authorizedRedirectUri;
  if (!uri) throw new Error('authorize: no authorized_redirect_uri in response');
  return uri;
}

async function connect(instrumentKeys) {
  if (!WS_ENABLED) {
    logger.info('[UpstoxWS] disabled (UPSTOX_WS_ENABLED!=true) — REST feed remains the price source');
    return;
  }
  if (_connected && _ws?.readyState === WebSocket.OPEN) {
    logger.debug('[UpstoxWS] Already connected');
    return;
  }

  const token = upstoxAuth.getAccessToken();
  if (!token) throw new Error('No Upstox token — OAuth first');

  _destroyed      = false;
  _subscribedKeys = instrumentKeys || _defaultWatchlist();

  const redirectUri = await _authorize(token);
  logger.info(`[UpstoxWS] Authorized — connecting (${_subscribedKeys.length} instruments, mode=${SUB_MODE})`);

  return new Promise((resolve, reject) => {
    // The redirect URI already embeds auth — no headers needed.
    _ws = new WebSocket(redirectUri, { handshakeTimeout: 15_000 });

    let resolved = false;
    const done = (err) => { if (resolved) return; resolved = true; err ? reject(err) : resolve(); };

    _ws.on('open', () => {
      _connected      = true;
      _reconnectCount = 0;
      _connectedAt    = new Date().toISOString();
      logger.info('[UpstoxWS] ✅ Connected (V3)');
      _subscribe(_subscribedKeys);
      _startPing();
      done();
    });

    _ws.on('message', (data) => {
      try { _onMessage(data); } catch (e) { logger.debug(`[UpstoxWS] msg decode: ${e.message}`); }
    });

    _ws.on('close', (code, reason) => {
      _connected = false;
      _stopPing();
      logger.warn(`[UpstoxWS] Closed ${code}: ${reason?.toString() || ''}`);
      if (!_destroyed) _scheduleReconnect();
      done(new Error(`WS closed ${code}`));
    });

    _ws.on('error', (err) => {
      logger.error(`[UpstoxWS] Error: ${err.message}`);
      done(err);
    });

    setTimeout(() => done(new Error('WS connect timeout 15s')), 15_000);
  });
}

function disconnect() {
  _destroyed = true;
  clearTimeout(_reconnectTimer);
  _stopPing();
  if (_ws) {
    _ws.removeAllListeners();
    try { _ws.close(); } catch (_) {}
    _ws = null;
  }
  _connected = false;
  logger.info('[UpstoxWS] Disconnected');
}

// ── Subscribe ─────────────────────────────────────────────────────────────────

function _subscribe(keys) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN || !keys?.length) return;
  // V3 expects the control message as a BINARY frame (Buffer of the JSON).
  const payload = {
    guid:   `sub-${Date.now()}`,
    method: 'sub',
    data:   { mode: SUB_MODE, instrumentKeys: keys },
  };
  _ws.send(Buffer.from(JSON.stringify(payload)));
  logger.info(`[UpstoxWS] Subscribed ${keys.length} instruments (mode=${SUB_MODE})`);
}

function subscribe(baseSymbols) {
  const keys    = symbols.toUpstoxKeys(baseSymbols);
  const newKeys = keys.filter(k => !_subscribedKeys.includes(k));
  if (!newKeys.length) return;
  _subscribedKeys.push(...newKeys);
  _subscribe(newKeys);
}

// ── Message handler ───────────────────────────────────────────────────────────

function _onMessage(raw) {
  if (!Buffer.isBuffer(raw)) {
    // Rare: a text frame (e.g. an error string). Log and ignore.
    try { logger.debug(`[UpstoxWS] text frame: ${String(raw).slice(0, 120)}`); } catch (_) {}
    return;
  }

  let decoded;
  try { decoded = upstoxProto.decode(raw); }
  catch (e) { logger.debug(`[UpstoxWS] protobuf decode failed: ${e.message}`); return; }

  const feeds = decoded?.feeds;
  if (!feeds) return;

  const ts    = new Date(decoded.currentTs || Date.now()).toISOString();
  const rawTs = Date.now();

  for (const [instrumentKey, t] of Object.entries(feeds)) {
    const ltp = t.ltp;
    if (!(ltp > 0)) continue;

    _priceCache.set(instrumentKey, { price: ltp, ts, rawTs });
    _recordTick();

    const baseSymbol = symbols.fromUpstox(instrumentKey);
    liveDataFeed.broadcastAll({
      type:         'PRICE',
      symbol:       baseSymbol || instrumentKey,
      instrumentKey,
      price:        ltp,
      change:       t.change,
      changePct:    t.changePct,
      source:       'LIVE_UPSTOX',
      ts,
    });
    logger.debug(`[UpstoxWS] Tick ${baseSymbol || instrumentKey} ₹${ltp} (${t.changePct >= 0 ? '+' : ''}${t.changePct}%)`);
  }
}

// ── Ping ──────────────────────────────────────────────────────────────────────

function _startPing() {
  _stopPing();
  _pingTimer = setInterval(() => {
    // Protocol-level ping keeps the connection alive; V3 has no JSON ping frame.
    if (_ws?.readyState === WebSocket.OPEN) { try { _ws.ping(); } catch (_) {} }
  }, PING_INTERVAL);
}

function _stopPing() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
}

// ── Reconnect ─────────────────────────────────────────────────────────────────

function _scheduleReconnect() {
  if (_destroyed) return;
  if (_reconnectCount >= MAX_RECONNECTS) {
    logger.error(`[UpstoxWS] Max reconnects (${MAX_RECONNECTS}) reached`);
    return;
  }

  const token = upstoxAuth.getAccessToken();
  if (!token) {
    logger.warn('[UpstoxWS] No token for reconnect — paused');
    return;
  }

  _reconnectCount++;
  // Exponential backoff capped at 2min
  const delay = Math.min(RECONNECT_BASE * Math.pow(1.5, _reconnectCount - 1), 120_000);
  logger.info(`[UpstoxWS] Reconnect #${_reconnectCount} in ${Math.round(delay/1000)}s`);

  _reconnectTimer = setTimeout(() => {
    connect(_subscribedKeys).catch(e => logger.warn(`[UpstoxWS] Reconnect failed: ${e.message}`));
  }, delay);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _defaultWatchlist() {
  const defaults = [
    'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','BAJFINANCE',
    'SBIN','BHARTIARTL','KOTAKBANK','LT','AXISBANK','WIPRO','ASIANPAINT','MARUTI',
    'TITAN','TECHM','SUNPHARMA','ULTRACEMCO','HCLTECH',
  ];
  return symbols.toUpstoxKeys(defaults);
}

function getStatus() {
  return {
    enabled:         WS_ENABLED,
    mode:            SUB_MODE,
    connected:       _connected,
    readyState:      _ws?.readyState ?? -1,
    subscribedCount: _subscribedKeys.length,
    subscribedKeys:  _subscribedKeys.slice(0, 100),
    cachedPrices:    _priceCache.size,
    reconnectCount:  _reconnectCount,
    destroyed:       _destroyed,
    connectedAt:     _connectedAt,
    tickCount:       _tickCount,
    tickRate:        _tickRate(),
    lastTickTs:      _lastTickTs,
  };
}

module.exports = { connect, disconnect, subscribe, getCachedPrice, getStatus };
