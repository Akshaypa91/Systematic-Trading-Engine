// src/services/marketDataService.js — HARDENED with getBestPrice()
'use strict';

const axios     = require('axios');
const symbolMap = require('../config/symbolMap');
const symbols   = require('../config/symbols');   // has toUpstox (instrument keys); symbolMap does not
const logger    = require('../config/logger');

let _upstoxWS = null;
function _getUpstoxWS() {
  if (!_upstoxWS) { try { _upstoxWS = require('../ws/upstoxWS'); } catch (_) {} }
  return _upstoxWS;
}

let _upstoxAuth = null;
function _getUpstoxAuth() {
  if (!_upstoxAuth) { try { _upstoxAuth = require('./upstoxAuth'); } catch (_) {} }
  return _upstoxAuth;
}
let _restFeed = null;
function _getRestFeed() {
  if (!_restFeed) { try { _restFeed = require('../data/upstoxRestFeed'); } catch (_) {} }
  return _restFeed;
}

// True when a real Upstox feed is delivering data — the (rarely working) WS OR
// the REST poller. Keeps SIM out while genuine prices are available, yet still
// lets a fully-down feed fall back to moving SIM instead of freezing.
function _brokerLive() {
  try {
    if (_getUpstoxWS()?.getStatus?.().connected) return true;
    const rf = _getRestFeed()?.getStatus?.();
    return !!(rf && rf.running && rf.authenticated);
  } catch (_) { return false; }
}

// ── Upstox REST snapshot (tier 2) ─────────────────────────────────────────────
// GET /v2/market-quote/ltp — used when the WS cache has no fresh tick for a
// symbol (e.g. just subscribed, or between reconnects).
async function _fetchUpstoxSnapshot(base) {
  const auth  = _getUpstoxAuth();
  const token = auth?.getAccessToken?.();
  if (!token) throw new Error('Upstox not authenticated');
  const key = symbols.toUpstox(base);
  if (!key) throw new Error(`No instrument key for ${base}`);
  const res = await axios.get('https://api.upstox.com/v2/market-quote/ltp', {
    headers: { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' },
    params: { instrument_key: key },
    timeout: TIMEOUT_MS,
  });
  const data = res.data?.data || {};
  // Response is keyed by "NSE_EQ:RELIANCE" (exchange:symbol), not the request key.
  const entry = Object.values(data)[0];
  const price = parseFloat(entry?.last_price);
  if (!isFinite(price) || price <= 0) throw new Error(`Upstox snapshot bad price for ${base}`);
  return price;
}

// ── Upstox historical candles (for the native chart) ──────────────────────────
// GET /v2/historical-candle/{key}/{interval}/{to}/{from}  (+ intraday for today).
// interval ∈ 1minute | 30minute | day | week | month. Returns newest-first
// [ts,o,h,l,c,vol,oi]; we normalise to ascending { t,o,h,l,c,v }.
async function getCandles(symbol, { interval = 'day', days = 120 } = {}) {
  const base  = symbolMap.toBase(symbol);
  const key   = symbols.toUpstox(base);
  const token = _getUpstoxAuth()?.getAccessToken?.();
  if (!key)   return { symbol: base, interval, candles: [], source: 'NONE', error: `No instrument key for ${base}` };
  if (!token) return { symbol: base, interval, candles: [], source: 'NONE', error: 'Upstox not authenticated' };

  const fmt = (d) => d.toISOString().slice(0, 10);
  const to   = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const headers = { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' };
  const rows = [];

  try {
    const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(key)}/${interval}/${fmt(to)}/${fmt(from)}`;
    const res = await axios.get(url, { headers, timeout: TIMEOUT_MS });
    for (const c of (res.data?.data?.candles || [])) rows.push(c);
  } catch (e) {
    logger.debug(`[MarketData] candles ${base}: ${e.message}`);
  }
  // Append today's intraday (1-minute) so the chart includes the live session.
  if (interval === 'day' || interval === '30minute') {
    try {
      const iurl = `https://api.upstox.com/v2/historical-candle/intraday/${encodeURIComponent(key)}/30minute`;
      const ires = await axios.get(iurl, { headers, timeout: TIMEOUT_MS });
      for (const c of (ires.data?.data?.candles || [])) rows.push(c);
    } catch (_) {}
  }

  const candles = rows
    .map(c => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }))
    .filter(c => isFinite(c.c))
    .sort((a, b) => new Date(a.t) - new Date(b.t));
  return { symbol: base, interval, candles, source: candles.length ? 'UPSTOX' : 'NONE' };
}

const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY || '';
const FINNHUB_KEY    = process.env.FINNHUB_API_KEY    || '';
// Accept either MARKET_DATA_CACHE_TTL_MS (ms) or legacy MARKET_DATA_CACHE_TTL
// (seconds). Only real-provider prices are cached; SIM prices are never cached
// so the tick loop advances them every tick (see getLivePrice).
const CACHE_TTL_MS   = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS
  || (process.env.MARKET_DATA_CACHE_TTL ? String(parseInt(process.env.MARKET_DATA_CACHE_TTL, 10) * 1000) : '3000'), 10);  // 3s default
const TIMEOUT_MS     = parseInt(process.env.MARKET_DATA_TIMEOUT_MS   || '8000', 10);
const BATCH_CHUNK    = 5;

// ── Circuit breakers ──────────────────────────────────────────────────────────

const CB_FAIL_THRESHOLD = 3;
const CB_COOLDOWN_MS    = 15 * 60 * 1000;

const _breakers = {
  twelvedata: { failures: 0, openedAt: 0 },
  finnhub:    { failures: 0, openedAt: 0 },
  nse:        { failures: 0, openedAt: 0 },
};

function _cbOpen(name) {
  const b = _breakers[name];
  if (!b || b.failures < CB_FAIL_THRESHOLD) return false;
  if (Date.now() - b.openedAt > CB_COOLDOWN_MS) {
    b.failures = 0; b.openedAt = 0;
    logger.info(`[MarketData] CB RESET ${name}`);
    return false;
  }
  return true;
}

function _cbFail(name) {
  const b = _breakers[name]; if (!b) return;
  b.failures++;
  if (b.failures === CB_FAIL_THRESHOLD) {
    b.openedAt = Date.now();
    logger.warn(`[MarketData] CB OPEN ${name} — ${CB_COOLDOWN_MS/60000}min cooldown`);
  }
}

function _cbOk(name) {
  const b = _breakers[name]; if (!b) return;
  b.failures = 0; b.openedAt = 0;
}

// ── Seed prices ───────────────────────────────────────────────────────────────

const SEED_PRICES = {
  RELIANCE:2850,INFY:1620,TCS:4200,HDFCBANK:1720,ICICIBANK:1180,
  WIPRO:560,SBIN:810,AXISBANK:1190,BAJFINANCE:6800,MARUTI:12500,
  TATAMOTORS:960,SUNPHARMA:1650,TECHM:1740,TITAN:3450,ULTRACEMCO:10200,
  LT:3700,HINDUNILVR:2480,KOTAKBANK:1940,ASIANPAINT:2850,ONGC:290,
  NTPC:350,BPCL:620,COALINDIA:460,CIPLA:1550,DRREDDY:6200,
  BRITANNIA:5400,GRASIM:2200,UPL:540,HCLTECH:1900,ITC:490,
  INDUSINDBK:1450,DIVISLAB:3800,HEROMOTOCO:5100,APOLLOHOSP:7200,
  EICHERMOT:4900,BAJAJFINSV:1850,POWERGRID:340,JSWSTEEL:980,
  HINDALCO:680,TATASTEEL:175,TATACONSUM:1100,NESTLEIND:2500,
  HDFCLIFE:780,SBILIFE:1650,ADANIENT:3200,ADANIPORTS:1450,
  BHARTIARTL:1780,LTIM:5800,'BAJAJ-AUTO':9200,'M&M':2900,
};

// ── Cache ─────────────────────────────────────────────────────────────────────

const _cache    = new Map();
const _simState = new Map();

function _cacheGet(base) {
  const e = _cache.get(base);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _cache.delete(base); return null; }
  return e;
}

function _cacheSet(base, price, source) {
  _cache.set(base, { price, source, timestamp: new Date().toISOString(), expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Simulation ────────────────────────────────────────────────────────────────

function _simPrice(base) {
  const seed = SEED_PRICES[base] || 1000;
  if (!_simState.has(base)) _simState.set(base, seed);
  const prev   = _simState.get(base);
  // ±0.8% random step per tick (was ±0.3%) so movement is clearly visible.
  // Mean-revert gently toward the seed so prices don't drift away over time.
  const revert = (seed - prev) * 0.02;
  const delta  = prev * (0.008 * (Math.random() * 2 - 1) + 0.00005) + revert;
  const next   = parseFloat((prev + delta).toFixed(2));
  _simState.set(base, next);
  return next;
}

// ── NSE client ────────────────────────────────────────────────────────────────

const _nseClient = axios.create({
  baseURL: 'https://www.nseindia.com',
  timeout: TIMEOUT_MS,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/get-quotes/equity',
  },
});

let _nseCookies     = '';
let _nseExpiry      = 0;   // when to refresh cookies (success expiry)
let _nseFailUntil   = 0;   // backoff: don't retry prime until this time
let _nseFailCount   = 0;   // consecutive prime failures
let _nsePriming     = false;

const NSE_PRIME_BACKOFF_BASE = 30_000;    // 30s base
const NSE_PRIME_MAX_BACKOFF  = 5 * 60 * 1000; // 5 min cap

async function _primeNSE() {
  // Already primed and cookies valid
  if (Date.now() < _nseExpiry && _nseCookies) return;
  // In failure backoff — don't hammer NSE
  if (Date.now() < _nseFailUntil) return;
  // Another call is already priming
  if (_nsePriming) return;

  _nsePriming = true;
  try {
    const res = await _nseClient.get('/', { timeout: 10_000 });
    const sc  = res.headers['set-cookie'];
    if (sc?.length) {
      _nseCookies   = sc.map(c => c.split(';')[0]).join('; ');
      _nseExpiry    = Date.now() + 10 * 60 * 1000;
      _nseFailCount = 0;
      _nseFailUntil = 0;
      logger.info(`[MarketData] NSE cookies primed (${sc.length})`);
    }
  } catch (e) {
    _nseFailCount++;
    // Exponential backoff capped at NSE_PRIME_MAX_BACKOFF
    const backoff   = Math.min(NSE_PRIME_BACKOFF_BASE * Math.pow(2, _nseFailCount - 1), NSE_PRIME_MAX_BACKOFF);
    _nseFailUntil   = Date.now() + backoff;
    _nseCookies     = '';
    _nseExpiry      = 0;
    logger.debug(`[MarketData] NSE prime failed (attempt ${_nseFailCount}): ${e.message} — retry in ${Math.round(backoff/1000)}s`);
  } finally {
    _nsePriming = false;
  }
}

async function _fetchNSE(base) {
  if (_cbOpen('nse')) throw new Error('NSE CB open');
  await _primeNSE();

  try {
    const res = await _nseClient.get(`/api/quote-equity?symbol=${encodeURIComponent(base)}`, {
      headers: _nseCookies ? { Cookie: _nseCookies } : {},
      timeout: TIMEOUT_MS,
    });

    const p = res.data?.priceInfo;
    if (!p) { _cbFail('nse'); throw new Error(`NSE no priceInfo for ${base}`); }

    const price = parseFloat(p.lastPrice);
    if (!isFinite(price) || price <= 0) { _cbFail('nse'); throw new Error(`NSE bad price ${p.lastPrice}`); }

    _cbOk('nse');
    return price;
  } catch (err) {
    if (err.response?.status === 403) {
      // Invalidate cookies + trigger backoff in _primeNSE next call
      _nseCookies   = '';
      _nseExpiry    = 0;
      _nseFailCount = Math.max(_nseFailCount, 1);
      _nseFailUntil = Date.now() + Math.min(NSE_PRIME_BACKOFF_BASE * Math.pow(2, _nseFailCount), NSE_PRIME_MAX_BACKOFF);
      _cbFail('nse');
    }
    throw err;
  }
}

// ── TwelveData ────────────────────────────────────────────────────────────────

async function _fetchTwelve(base) {
  if (!TWELVEDATA_KEY) throw new Error('No TWELVEDATA_API_KEY');
  if (_cbOpen('twelvedata')) throw new Error('TwelveData CB open');

  const sym  = symbolMap.toTwelve(base);
  const res  = await axios.get('https://api.twelvedata.com/price', {
    params: { symbol: sym, apikey: TWELVEDATA_KEY },
    timeout: TIMEOUT_MS,
  });

  const d = res.data;
  if (d.code !== undefined || d.status === 'error') {
    _cbFail('twelvedata');
    throw new Error(`TwelveData error: ${d.message || JSON.stringify(d)}`);
  }

  const price = parseFloat(d.price);
  if (!isFinite(price) || price < 10) { _cbFail('twelvedata'); throw new Error(`TwelveData bad price ${d.price}`); }
  _cbOk('twelvedata');
  return price;
}

// ── Finnhub ───────────────────────────────────────────────────────────────────

async function _fetchFinnhub(base) {
  if (!FINNHUB_KEY) throw new Error('No FINNHUB_API_KEY');
  if (_cbOpen('finnhub')) throw new Error('Finnhub CB open');

  const sym = symbolMap.toFinnhub(base);
  const res = await axios.get('https://finnhub.io/api/v1/quote', {
    params: { symbol: sym, token: FINNHUB_KEY },
    timeout: TIMEOUT_MS,
  });

  if (res.data.error) { _cbFail('finnhub'); throw new Error(`Finnhub: ${res.data.error}`); }

  const price = parseFloat(res.data.c);
  if (!isFinite(price) || price < 10) { _cbFail('finnhub'); throw new Error(`Finnhub bad price ${res.data.c}`); }
  _cbOk('finnhub');
  return price;
}

// ── getBestPrice (canonical) ──────────────────────────────────────────────────
// Priority: Upstox WS cache → NSE → SIM
// Never throws. Always returns { price, source }
async function getBestPrice(symbol) {
  const base = symbolMap.toBase(symbol);

  // 1. Upstox live
  try {
    const ws = _getUpstoxWS();
    if (ws) {
      const cached = ws.getCachedPrice(base);
      if (cached) {
        logger.debug(`[MarketData] UPSTOX ✅ ${base} = ₹${cached.price}`);
        return { price: cached.price, source: 'UPSTOX' };
      }
    }
  } catch (_) {}

  // 2. Upstox REST snapshot
  try {
    const price = await _fetchUpstoxSnapshot(base);
    return { price, source: 'UPSTOX_REST' };
  } catch (_) {}

  // 3. NSE
  try {
    const price = await _fetchNSE(base);
    logger.debug(`[MarketData] NSE ✅ ${base} = ₹${price}`);
    return { price, source: 'NSE' };
  } catch (e) {
    logger.debug(`[MarketData] NSE skip ${base}: ${e.message}`);
  }

  // 4. SIM — only when no broker session (never fabricate over live data)
  if (_brokerLive()) {
    const stale = _cache.get(base);
    if (stale) return { price: stale.price, source: stale.source, stale: true };
    return { price: null, source: 'UNAVAILABLE' };
  }
  const price = _simPrice(base);
  logger.debug(`[MarketData] SIM ${base} = ₹${price}`);
  return { price, source: 'SIM' };
}

// ── getLivePrice (full chain with cache) ──────────────────────────────────────

async function getLivePrice(symbol) {
  const base   = symbolMap.toBase(symbol);
  const cached = _cacheGet(base);
  if (cached) return { symbol: base, price: cached.price, source: cached.source, timestamp: cached.timestamp };

  // 1. Upstox WebSocket cache (PRIMARY, when it works)
  try {
    const ws = _getUpstoxWS();
    if (ws) {
      const c = ws.getCachedPrice(base);
      if (c) { _cacheSet(base, c.price, 'LIVE_UPSTOX'); return { symbol: base, price: c.price, source: 'LIVE_UPSTOX', timestamp: c.timestamp }; }
    }
  } catch (_) {}

  // 1b. Upstox REST poller cache (the reliable primary in practice)
  try {
    const rf = _getRestFeed();
    if (rf) {
      const c = rf.getCachedPrice(base);
      if (c) { _cacheSet(base, c.price, 'LIVE_UPSTOX'); return { symbol: base, price: c.price, source: 'LIVE_UPSTOX', timestamp: c.timestamp }; }
    }
  } catch (_) {}

  // 2. Upstox REST snapshot (on-demand, when the poller hasn't cached yet)
  try {
    const p = await _fetchUpstoxSnapshot(base);
    _cacheSet(base, p, 'LIVE_UPSTOX_REST');
    return { symbol: base, price: p, source: 'LIVE_UPSTOX_REST', timestamp: new Date().toISOString() };
  } catch (e) {
    if (_brokerLive()) logger.debug(`[MarketData] Upstox snapshot ${base}: ${e.message}`);
  }

  // 3. NSE
  try {
    const p = await _fetchNSE(base);
    _cacheSet(base, p, 'LIVE_NSE');
    return { symbol: base, price: p, source: 'LIVE_NSE', timestamp: new Date().toISOString() };
  } catch (e) {
    logger.warn(`[MarketData] NSE ${base}: ${e.message}`);
  }

  // 4. External APIs
  try {
    const p = await _fetchTwelve(base);
    _cacheSet(base, p, 'LIVE_TWELVE');
    return { symbol: base, price: p, source: 'LIVE_TWELVE', timestamp: new Date().toISOString() };
  } catch (e) {
    logger.warn(`[MarketData] TwelveData ${base}: ${e.message}`);
  }
  try {
    const p = await _fetchFinnhub(base);
    _cacheSet(base, p, 'LIVE_FINNHUB');
    return { symbol: base, price: p, source: 'LIVE_FINNHUB', timestamp: new Date().toISOString() };
  } catch (e) {
    logger.warn(`[MarketData] Finnhub ${base}: ${e.message}`);
  }

  // 5. Stale cache — if a broker session is live, prefer a last-known real price
  // over a fabricated one. Never surface SIM while Upstox is authenticated.
  const stale = _cache.get(base);
  if (stale) return { symbol: base, price: stale.price, source: stale.source, timestamp: stale.timestamp, stale: true };
  if (_brokerLive()) {
    return { symbol: base, price: null, source: 'UNAVAILABLE', timestamp: new Date().toISOString() };
  }

  // 6. SIM — only when NO broker session exists (paper / logged-out demo mode).
  const p = _simPrice(base);
  return { symbol: base, price: p, source: 'SIM', timestamp: new Date().toISOString() };
}

// ── Batch ─────────────────────────────────────────────────────────────────────

async function getBatchPrices(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return [];

  const bases   = symbols.map(s => symbolMap.toBase(s));
  const results = [];
  const miss    = [];

  for (const base of bases) {
    const c = _cacheGet(base);
    if (c) results.push({ symbol: base, price: c.price, source: c.source, timestamp: c.timestamp });
    else   miss.push(base);
  }

  for (const base of miss) {
    const r = await getLivePrice(base);
    results.push(r);
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearCache(symbol = null) {
  if (symbol) _cache.delete(symbolMap.toBase(symbol));
  else        _cache.clear();
}

function getCacheStats() {
  const entries = [..._cache.values()];
  const ws      = _getUpstoxWS();
  return {
    size: entries.length,
    sources: entries.reduce((a, e) => { a[e.source] = (a[e.source] || 0) + 1; return a; }, {}),
    ttlMs:       CACHE_TTL_MS,
    upstoxWS:    ws?.getStatus() ?? { connected: false },
    nseCookies:  !!_nseCookies,
    breakers: {
      twelvedata: { ..._breakers.twelvedata, open: _cbOpen('twelvedata') },
      finnhub:    { ..._breakers.finnhub,    open: _cbOpen('finnhub')    },
      nse:        { ..._breakers.nse,        open: _cbOpen('nse')        },
    },
  };
}

async function healthCheck() {
  const r = { upstox: { ok: false }, nse: { ok: false }, twelvedata: { ok: false }, finnhub: { ok: false } };
  try { const ws = _getUpstoxWS(); r.upstox = { ok: !!ws?.getCachedPrice('INFY'), wsStatus: ws?.getStatus() }; } catch (_) {}
  try { const p = await _fetchNSE('INFY'); r.nse = { ok: true, price: p }; } catch (e) { r.nse = { ok: false, error: e.message }; }
  if (TWELVEDATA_KEY) { try { const p = await _fetchTwelve('INFY'); r.twelvedata = { ok: true, price: p }; } catch (e) { r.twelvedata = { ok: false, error: e.message }; } }
  if (FINNHUB_KEY)    { try { const p = await _fetchFinnhub('INFY'); r.finnhub   = { ok: true, price: p }; } catch (e) { r.finnhub   = { ok: false, error: e.message }; } }
  r.overall = r.upstox.ok || r.nse.ok || r.twelvedata.ok || r.finnhub.ok;
  return r;
}

module.exports = { getLivePrice, getBestPrice, getBatchPrices, getCandles, clearCache, getCacheStats, healthCheck };
