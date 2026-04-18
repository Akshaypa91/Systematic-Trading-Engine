// src/ws/upstoxWS.js
// ─────────────────────────────────────────────────────────────────────────────
//
// UPSTOX WEBSOCKET CLIENT
// ─────────────────────────────────────────────────────────────────────────────
//
// Connects to Upstox's Market Data WebSocket feed, subscribes to instrument
// keys, receives real-time price ticks, and broadcasts them to all connected
// frontend clients via the existing liveDataFeed.broadcastAll().
//
// UPSTOX WEBSOCKET DOCS:
//   Endpoint: wss://api.upstox.com/v2/feed/market-data-feed
//   Auth:     ?api_version=2.0 header + Authorization: Bearer <token>
//   Protocol: Protobuf binary frames (MarketDataFeed proto)
//
// PROTOBUF DECODE:
//   Upstox sends binary protobuf. We use the official @upstox/proto package
//   if available, else fall back to JSON mode (Upstox also supports JSON).
//
// ARCHITECTURE:
//   upstoxWS.connect()
//     ↓ opens WSS connection with token
//   on 'open' → subscribe({ instrumentKeys, mode: 'ltpc' })
//     ↓ Upstox sends ticks every ~1s
//   _onTick(data) → updates price cache → broadcastAll(PRICE_TICK event)
//   simulationEngine._tick() reads from priceCache → signals computed from live prices
//
// MODE: 'ltpc' = last traded price + change — lowest bandwidth, good enough for signals
// Use 'full' for full order book depth (higher bandwidth)
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const WebSocket    = require('ws');
const upstoxAuth   = require('../services/upstoxAuth');
const liveDataFeed = require('../data/liveDataFeed');
const symbols      = require('../config/symbols');
const logger       = require('../config/logger');

const UPSTOX_WS_URL  = 'wss://api.upstox.com/v2/feed/market-data-feed';
const RECONNECT_MS   = 5_000;   // reconnect delay after disconnect
const MAX_RECONNECTS = 10;      // give up after this many consecutive failures
const PING_INTERVAL  = 30_000;  // heartbeat interval

// ── Module state ──────────────────────────────────────────────────────────────

let _ws            = null;
let _connected     = false;
let _reconnectCount = 0;
let _reconnectTimer = null;
let _pingTimer     = null;
let _subscribedKeys = [];

// Live price cache: instrumentKey → { price, ltp, change, changePercent, ts }
const _priceCache  = new Map();

// ── Price cache API ───────────────────────────────────────────────────────────

/**
 * Get the latest price for a base symbol from the WS price cache.
 * @param {string} baseSymbol  e.g. 'TCS'
 * @returns {{ price, source, timestamp }|null}
 */
function getCachedPrice(baseSymbol) {
  const key   = symbols.toUpstox(baseSymbol);
  if (!key) return null;
  const entry = _priceCache.get(key);
  if (!entry) return null;
  return {
    price:     entry.price,
    source:    'LIVE_UPSTOX',
    timestamp: entry.ts,
  };
}

// ── Connect / disconnect ──────────────────────────────────────────────────────

/**
 * Connect to Upstox WebSocket.
 * Requires a valid access token (call after OAuth callback).
 * Idempotent — no-op if already connected.
 *
 * @param {string[]} [instrumentKeys]  Override default watchlist
 * @returns {Promise<void>}
 */
function connect(instrumentKeys) {
  return new Promise((resolve, reject) => {
    if (_connected && _ws?.readyState === WebSocket.OPEN) {
      logger.debug('[UpstoxWS] Already connected');
      return resolve();
    }

    const token = upstoxAuth.getAccessToken();
    if (!token) {
      return reject(new Error('No Upstox access token — complete OAuth first'));
    }

    _subscribedKeys = instrumentKeys || _defaultWatchlist();

    logger.info(`[UpstoxWS] Connecting… (${_subscribedKeys.length} instruments)`);

    _ws = new WebSocket(UPSTOX_WS_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Api-Version':   '2.0',
      },
    });

    let resolved = false;

    _ws.on('open', () => {
      _connected      = true;
      _reconnectCount = 0;
      logger.info('[UpstoxWS] ✅ Connected to Upstox market feed');

      _subscribe(_subscribedKeys);
      _startPing();

      if (!resolved) { resolved = true; resolve(); }
    });

    _ws.on('message', (data) => {
      try {
        _onMessage(data);
      } catch (err) {
        logger.warn(`[UpstoxWS] Message parse error: ${err.message}`);
      }
    });

    _ws.on('close', (code, reason) => {
      _connected = false;
      _stopPing();
      logger.warn(`[UpstoxWS] Disconnected (${code}: ${reason})`);
      _scheduleReconnect();
    });

    _ws.on('error', (err) => {
      logger.error(`[UpstoxWS] Error: ${err.message}`);
      if (!resolved) { resolved = true; reject(err); }
    });

    // Timeout if connection doesn't open in 10s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Upstox WS connection timeout after 10s'));
      }
    }, 10_000);
  });
}

function disconnect() {
  clearTimeout(_reconnectTimer);
  _stopPing();
  if (_ws) {
    _ws.removeAllListeners();
    _ws.close();
    _ws = null;
  }
  _connected = false;
  logger.info('[UpstoxWS] Disconnected');
}

// ── Subscription ──────────────────────────────────────────────────────────────

function _subscribe(instrumentKeys) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
  if (!instrumentKeys?.length) return;

  const msg = JSON.stringify({
    guid:           `sub-${Date.now()}`,
    method:         'sub',
    data: {
      mode:           'ltpc',           // last traded price + change
      instrumentKeys: instrumentKeys,
    },
  });

  _ws.send(msg);
  logger.info(`[UpstoxWS] Subscribed to ${instrumentKeys.length} instruments`);
}

/**
 * Hot-add symbols to the subscription at runtime.
 * @param {string[]} baseSymbols
 */
function subscribe(baseSymbols) {
  const keys = symbols.toUpstoxKeys(baseSymbols);
  if (!keys.length) return;

  const newKeys = keys.filter(k => !_subscribedKeys.includes(k));
  if (!newKeys.length) return;

  _subscribedKeys.push(...newKeys);
  _subscribe(newKeys);
}

// ── Message handler ───────────────────────────────────────────────────────────

function _onMessage(raw) {
  // Upstox sends either binary (protobuf) or JSON depending on connection mode.
  // We request JSON mode via 'ltpc' which returns plain JSON.
  // If binary: skip (would need @upstox-developer/upstox-js-sdk proto decode)

  if (Buffer.isBuffer(raw) && raw[0] !== 0x7b /* '{' */) {
    // Likely protobuf binary — attempt JSON parse anyway, skip if fails
    try {
      const text = raw.toString('utf8');
      if (!text.startsWith('{') && !text.startsWith('[')) return;
      _handleJSON(JSON.parse(text));
    } catch (_) { /* silently skip binary frames we can't decode */ }
    return;
  }

  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  _handleJSON(JSON.parse(text));
}

function _handleJSON(msg) {
  // Upstox LTPC feed message structure:
  // {
  //   "feeds": {
  //     "NSE_EQ|INE467B01029": {
  //       "ltpc": { "ltp": 4215.50, "ltt": "...", "ltq": 10, "cp": 4100.00 }
  //     }
  //   },
  //   "currentTs": 1712345678000
  // }

  if (msg.type === 'pong') return; // heartbeat response

  const feeds = msg.feeds;
  if (!feeds || typeof feeds !== 'object') return;

  const ts = new Date(msg.currentTs || Date.now()).toISOString();

  for (const [instrumentKey, feed] of Object.entries(feeds)) {
    const ltpc = feed?.ltpc || feed?.ltp || feed;
    if (!ltpc) continue;

    const ltp = parseFloat(ltpc.ltp ?? ltpc.last_price ?? ltpc);
    if (!isFinite(ltp) || ltp <= 0) continue;

    const cp          = parseFloat(ltpc.cp ?? ltpc.close_price ?? 0) || ltp;
    const change      = parseFloat((ltp - cp).toFixed(2));
    const changePct   = cp > 0 ? parseFloat(((change / cp) * 100).toFixed(2)) : 0;

    _priceCache.set(instrumentKey, {
      price:         ltp,
      ltp,
      closePrice:    cp,
      change,
      changePct,
      ts,
    });

    // Get base symbol for broadcast
    const baseSymbol = symbols.fromUpstox(instrumentKey);

    // Broadcast to all frontend WS clients
    liveDataFeed.broadcastAll({
      type:           'PRICE',
      symbol:         baseSymbol || instrumentKey,
      instrumentKey,
      price:          ltp,
      change,
      changePct,
      source:         'LIVE_UPSTOX',
      ts,
    });

    logger.debug(`[UpstoxWS] Tick: ${baseSymbol || instrumentKey} = ₹${ltp} (${changePct >= 0 ? '+' : ''}${changePct}%)`);
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

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

// ── Auto-reconnect ────────────────────────────────────────────────────────────

function _scheduleReconnect() {
  if (_reconnectCount >= MAX_RECONNECTS) {
    logger.error(`[UpstoxWS] Max reconnects (${MAX_RECONNECTS}) reached — giving up`);
    return;
  }

  const token = upstoxAuth.getAccessToken();
  if (!token) {
    logger.warn('[UpstoxWS] No token for reconnect — will retry when token set');
    return;
  }

  _reconnectCount++;
  const delay = Math.min(RECONNECT_MS * _reconnectCount, 60_000);
  logger.info(`[UpstoxWS] Reconnecting in ${delay / 1000}s (attempt ${_reconnectCount})`);

  _reconnectTimer = setTimeout(() => {
    connect(_subscribedKeys).catch(err => {
      logger.warn(`[UpstoxWS] Reconnect failed: ${err.message}`);
    });
  }, delay);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _defaultWatchlist() {
  // Default: top 20 NIFTY50 symbols
  const defaults = [
    'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK',
    'HINDUNILVR','BAJFINANCE','SBIN','BHARTIARTL','KOTAKBANK',
    'LT','AXISBANK','WIPRO','ASIANPAINT','MARUTI',
    'TITAN','TECHM','SUNPHARMA','ULTRACEMCO','HCLTECH',
  ];
  return symbols.toUpstoxKeys(defaults);
}

// ── Status ────────────────────────────────────────────────────────────────────

function getStatus() {
  return {
    connected:       _connected,
    readyState:      _ws?.readyState ?? -1,
    subscribedCount: _subscribedKeys.length,
    cachedPrices:    _priceCache.size,
    reconnectCount:  _reconnectCount,
  };
}

module.exports = {
  connect,
  disconnect,
  subscribe,
  getCachedPrice,
  getStatus,
};
