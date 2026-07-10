// src/ws/upstoxWS.js — HARDENED
'use strict';

const WebSocket    = require('ws');
const upstoxAuth   = require('../services/upstoxAuth');
const liveDataFeed = require('../data/liveDataFeed');
const symbols      = require('../config/symbols');
const logger       = require('../config/logger');

const UPSTOX_WS_URL  = 'wss://api.upstox.com/v2/feed/market-data-feed';
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

function connect(instrumentKeys) {
  return new Promise((resolve, reject) => {
    if (_connected && _ws?.readyState === WebSocket.OPEN) {
      logger.debug('[UpstoxWS] Already connected');
      return resolve();
    }

    const token = upstoxAuth.getAccessToken();
    if (!token) {
      return reject(new Error('No Upstox token — OAuth first'));
    }

    _destroyed      = false;
    _subscribedKeys = instrumentKeys || _defaultWatchlist();

    logger.info(`[UpstoxWS] Connecting (${_subscribedKeys.length} instruments) token_len=${token.length}`);

    _ws = new WebSocket(UPSTOX_WS_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Api-Version':   '2.0',
      },
      handshakeTimeout: 15_000,
    });

    let resolved = false;
    const done = (err) => {
      if (resolved) return;
      resolved = true;
      err ? reject(err) : resolve();
    };

    _ws.on('open', () => {
      _connected      = true;
      _reconnectCount = 0;
      _connectedAt    = new Date().toISOString();
      logger.info('[UpstoxWS] ✅ Connected');
      _subscribe(_subscribedKeys);
      _startPing();
      done();
    });

    _ws.on('message', (data) => {
      try { _onMessage(data); } catch (e) { logger.debug(`[UpstoxWS] msg parse: ${e.message}`); }
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
  const msg = JSON.stringify({
    guid:   `sub-${Date.now()}`,
    method: 'sub',
    data:   { mode: 'ltpc', instrumentKeys: keys },
  });
  _ws.send(msg);
  logger.info(`[UpstoxWS] Subscribed ${keys.length} instruments`);
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
  let text;
  try {
    text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    if (!text.startsWith('{') && !text.startsWith('[')) return; // binary proto — skip
  } catch (_) { return; }

  let msg;
  try { msg = JSON.parse(text); } catch (_) { return; }

  if (msg.type === 'pong') return;

  const feeds = msg.feeds;
  if (!feeds || typeof feeds !== 'object') return;

  const ts    = new Date(msg.currentTs || Date.now()).toISOString();
  const rawTs = Date.now();

  for (const [instrumentKey, feed] of Object.entries(feeds)) {
    const ltpc = feed?.ltpc || feed;
    if (!ltpc) continue;

    const ltp = parseFloat(ltpc.ltp ?? ltpc.last_price ?? 0);
    if (!isFinite(ltp) || ltp <= 0) continue;

    const cp        = parseFloat(ltpc.cp ?? ltpc.close_price ?? 0) || ltp;
    const change    = parseFloat((ltp - cp).toFixed(2));
    const changePct = cp > 0 ? parseFloat(((change / cp) * 100).toFixed(2)) : 0;

    _priceCache.set(instrumentKey, { price: ltp, ts, rawTs });
    _recordTick();

    const baseSymbol = symbols.fromUpstox(instrumentKey);

    liveDataFeed.broadcastAll({
      type:         'PRICE',
      symbol:       baseSymbol || instrumentKey,
      instrumentKey,
      price:        ltp,
      change,
      changePct,
      source:       'LIVE_UPSTOX',
      ts,
    });

    logger.debug(`[UpstoxWS] Tick ${baseSymbol || instrumentKey} ₹${ltp} (${changePct >= 0 ? '+' : ''}${changePct}%)`);
  }
}

// ── Ping ──────────────────────────────────────────────────────────────────────

function _startPing() {
  _stopPing();
  _pingTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ guid: `ping-${Date.now()}`, method: 'ping', data: {} }));
    }
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
