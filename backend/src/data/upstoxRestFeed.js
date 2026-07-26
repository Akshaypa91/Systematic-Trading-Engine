// src/data/upstoxRestFeed.js
// ─────────────────────────────────────────────────────────────────────────────
// Real-time price feed via Upstox REST market-quote polling.
//
// Why not the WebSocket? The Upstox v2 market-data WS requires an /authorize
// handshake + Protobuf binary decoding that the current ws/upstoxWS.js doesn't
// implement, so it never streams. This service uses the ordinary REST token
// (the same one that already powers funds/profile) to batch-poll LTP+OHLC for
// all subscribed symbols and broadcasts PRICE ticks — reliable, no protobuf.
//
// It exposes getCachedPrice()/getStatus() with the same shape as ws/upstoxWS so
// marketDataService and the diagnostics endpoint can read it transparently.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const axios      = require('axios');
const upstoxAuth = require('../services/upstoxAuth');
const symbols    = require('../config/symbols');
const logger     = require('../config/logger');

const POLL_MS   = parseInt(process.env.UPSTOX_REST_POLL_MS || '1500', 10);
const BATCH_MAX = 480;                                   // Upstox LTP cap ~500/keys
const QUOTE_URL = 'https://api.upstox.com/v2/market-quote/quotes';   // full quote (ltp+ohlc+depth)

const _subs        = new Map();   // base symbol → subscriber count
const _priceCache  = new Map();   // base symbol → { price, ts, rawTs, change, changePct, volume }
let _timer         = null;
let _tickCount     = 0;
let _lastTickTs    = null;
let _lastError     = null;
let _polling       = false;
const _tickWindow  = [];

let _feed = null;                 // lazy liveDataFeed (avoid require cycle)
function _getFeed() { if (!_feed) { try { _feed = require('./liveDataFeed'); } catch (_) {} } return _feed; }

function _headers(token) {
  return { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' };
}

function _recordTick() {
  _tickCount++;
  const now = Date.now();
  _lastTickTs = new Date(now).toISOString();
  _tickWindow.push(now);
  const cutoff = now - 5000;
  while (_tickWindow.length && _tickWindow[0] < cutoff) _tickWindow.shift();
}

// ── Subscription API ──────────────────────────────────────────────────────────
function subscribe(baseSymbols = []) {
  for (const raw of baseSymbols) {
    const s = String(raw || '').toUpperCase().trim();
    if (!s) continue;
    _subs.set(s, (_subs.get(s) || 0) + 1);
  }
  ensureRunning();
}
function unsubscribe(baseSymbols = []) {
  for (const raw of baseSymbols) {
    const s = String(raw || '').toUpperCase().trim();
    const n = _subs.get(s) || 0;
    if (n <= 1) { _subs.delete(s); _priceCache.delete(s); }
    else _subs.set(s, n - 1);
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
function ensureRunning() {
  if (_timer) return;
  if (!upstoxAuth.isAuthenticated()) return;
  _timer = setInterval(() => { _pollOnce().catch(() => {}); }, POLL_MS);
  logger.info(`[UpstoxRest] price feed started (${POLL_MS}ms)`);
  _pollOnce().catch(() => {});
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; logger.info('[UpstoxRest] price feed stopped'); }
}

async function _pollOnce() {
  if (_polling) return;
  const token = upstoxAuth.getAccessToken();
  if (!token) return;
  const bases = [...new Set([..._subs.keys(), ...DEFAULT_WATCH])];
  if (!bases.length) return;

  // Resolve base symbols → instrument keys (curated map → full master).
  const pairs = bases.map(b => [b, symbols.toUpstox(b)]).filter(([, k]) => !!k);
  if (!pairs.length) return;

  _polling = true;
  try {
    // Batch in chunks to stay under the per-request key cap.
    for (let i = 0; i < pairs.length; i += BATCH_MAX) {
      const chunk = pairs.slice(i, i + BATCH_MAX);
      const keys  = chunk.map(([, k]) => k).join(',');
      const res = await axios.get(QUOTE_URL, { headers: _headers(token), params: { instrument_key: keys }, timeout: 10_000 });
      const data = res.data?.data || {};
      // Response is keyed by "NSE_EQ:SYMBOL". Map back to our base symbols.
      for (const [respKey, q] of Object.entries(data)) {
        const ltp = Number(q?.last_price);
        if (!isFinite(ltp) || ltp <= 0) continue;
        const base = symbols.fromUpstox((q.instrument_token || '').toString())
          || respKey.split(':')[1] || respKey;
        const prevClose = Number(q?.ohlc?.close ?? q?.last_price);
        const tick = {
          price: ltp,
          ts: new Date().toISOString(),
          rawTs: Date.now(),
          change: prevClose ? +(ltp - prevClose).toFixed(2) : 0,
          changePct: prevClose ? +(((ltp - prevClose) / prevClose) * 100).toFixed(2) : 0,
          volume: Number(q?.volume) || 0,
        };
        _priceCache.set(String(base).toUpperCase(), tick);
        _recordTick();
        _getFeed()?.broadcastAll?.({
          type: 'PRICE', symbol: String(base).toUpperCase(),
          price: ltp, change: tick.change, changePct: tick.changePct,
          source: 'LIVE_UPSTOX', ts: tick.ts,
        });
      }
    }
    _lastError = null;
  } catch (err) {
    const status = err.response?.status;
    _lastError = err.response?.data?.message || err.message;
    // A 401/403 means the Upstox token is dead (expired or revoked). Keeping it
    // would (a) let the UI keep claiming "broker authenticated" and (b) hammer
    // Upstox every poll with a bad token. Clear it so the status is honest and
    // the app prompts a reconnect, and stop the loop until re-authenticated.
    if (status === 401 || status === 403) {
      _lastError = `Upstox token rejected (${status}) — reconnect required`;
      logger.warn(`[UpstoxRest] ${_lastError} — clearing token and stopping feed`);
      try { upstoxAuth.clearToken(); } catch (_) {}
      stop();
    } else {
      logger.debug(`[UpstoxRest] poll error: ${_lastError}`);
    }
  } finally {
    _polling = false;
  }
}

// Always keep the core watchlist warm so the dashboard/signals have live prices
// even before a component subscribes.
const DEFAULT_WATCH = (process.env.SIM_WATCHLIST
  || 'RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,WIPRO,SBIN,AXISBANK,BAJFINANCE,KOTAKBANK').split(',').map(s => s.trim().toUpperCase());

// ── Read API (mirrors ws/upstoxWS) ────────────────────────────────────────────
function getCachedPrice(baseSymbol) {
  const s = String(baseSymbol || '').toUpperCase().trim();
  const e = _priceCache.get(s);
  if (!e) return null;
  if (Date.now() - e.rawTs > 30_000) return null;   // stale after 30s
  return { price: e.price, source: 'LIVE_UPSTOX', timestamp: e.ts };
}
function tickRate() { return Math.round((_tickWindow.length / 5) * 10) / 10; }
function getStatus() {
  const subscribed = [...new Set([..._subs.keys(), ...DEFAULT_WATCH])];
  // Per-symbol coverage: which subscribed symbols actually have a price. A
  // symbol that never populates points at a bad instrument key or an upstream
  // omission — without this you only see "8 of 10" and can't tell which two.
  const missing = subscribed.filter(s => !_priceCache.has(s));
  return {
    running:        !!_timer,
    authenticated:  upstoxAuth.isAuthenticated(),
    pollMs:         POLL_MS,
    subscribed,
    missingSymbols: missing,
    cachedPrices:   _priceCache.size,
    tickCount:      _tickCount,
    tickRate:       tickRate(),
    lastTickTs:     _lastTickTs,
    lastError:      _lastError,
  };
}

module.exports = { subscribe, unsubscribe, ensureRunning, stop, getCachedPrice, getStatus };
