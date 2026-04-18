// src/services/marketDataService.js
// ─────────────────────────────────────────────────────────────────────────────
//
// MARKET DATA SERVICE — Multi-API fallback price feed
//
// PRIORITY CHAIN (per symbol, per request):
//   0. Upstox WS cache  (real-time tick, <1s latency) → source: "LIVE_UPSTOX"
//   1. NSE India REST   (free, ~1 req/s safe rate)    → source: "LIVE_NSE"
//   2. TwelveData REST  (free tier: ~8 req/min)       → source: "LIVE_TWELVE"
//   3. Finnhub REST     (free tier: NSE paid only)    → source: "LIVE_FINNHUB"
//   4. Simulation       (GBM random walk)             → source: "SIM"
//
// TwelveData & Finnhub have circuit breakers — auto-skipped after repeated
// failures to stop wasting calls & log noise.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const axios     = require('axios');
const symbolMap = require('../config/symbolMap');
const logger    = require('../config/logger');

// Upstox WS cache — lazy require to avoid circular dep
let _upstoxWS = null;
function _getUpstoxWS() {
  if (!_upstoxWS) {
    try { _upstoxWS = require('../ws/upstoxWS'); } catch (_) {}
  }
  return _upstoxWS;
}

// ── Config ────────────────────────────────────────────────────────────────────

const TWELVEDATA_KEY  = process.env.TWELVEDATA_API_KEY  || '';
const FINNHUB_KEY     = process.env.FINNHUB_API_KEY     || '';

const TWELVEDATA_URL  = 'https://api.twelvedata.com';
const FINNHUB_URL     = 'https://finnhub.io/api/v1';
const NSE_BASE_URL    = 'https://www.nseindia.com';

const CACHE_TTL_MS    = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || '8000',  10);
const TIMEOUT_MS      = parseInt(process.env.MARKET_DATA_TIMEOUT_MS   || '8000',  10);
const BATCH_CHUNK     = 5;

// Circuit breaker config
const CB_FAIL_THRESHOLD = 3;                 // consecutive failures to trip
const CB_COOLDOWN_MS    = 15 * 60 * 1000;    // 15 min cooldown

// ── Circuit breakers (per provider) ───────────────────────────────────────────

const _breakers = {
  twelvedata: { failures: 0, openedAt: 0 },
  finnhub:    { failures: 0, openedAt: 0 },
  nse:        { failures: 0, openedAt: 0 },
};

function _cbOpen(name) {
  const b = _breakers[name];
  if (!b) return false;
  if (b.failures < CB_FAIL_THRESHOLD) return false;
  if (Date.now() - b.openedAt > CB_COOLDOWN_MS) {
    // Cooldown done — reset & try again
    b.failures = 0;
    b.openedAt = 0;
    logger.info(`[MarketData] Circuit breaker RESET for ${name}`);
    return false;
  }
  return true;
}

function _cbRecordFail(name) {
  const b = _breakers[name];
  if (!b) return;
  b.failures += 1;
  if (b.failures === CB_FAIL_THRESHOLD) {
    b.openedAt = Date.now();
    logger.warn(`[MarketData] Circuit breaker OPEN for ${name} — cooling down ${CB_COOLDOWN_MS/1000}s`);
  }
}

function _cbRecordSuccess(name) {
  const b = _breakers[name];
  if (!b) return;
  b.failures = 0;
  b.openedAt = 0;
}

// ── Seed prices (INR baseline for simulation) ─────────────────────────────────

const SEED_PRICES = {
  RELIANCE: 2850, INFY: 1620,  TCS: 4200,  HDFCBANK: 1720, ICICIBANK: 1180,
  WIPRO: 560,     SBIN: 810,   AXISBANK: 1190, BAJFINANCE: 6800, MARUTI: 12500,
  TATAMOTORS: 960,SUNPHARMA: 1650, TECHM: 1740, TITAN: 3450, ULTRACEMCO: 10200,
  LT: 3700, HINDUNILVR: 2480, KOTAKBANK: 1940, ASIANPAINT: 2850, ONGC: 290,
  NTPC: 350, BPCL: 620, COALINDIA: 460, CIPLA: 1550, DRREDDY: 6200,
  BRITANNIA: 5400, GRASIM: 2200, UPL: 540, HCLTECH: 1900, ITC: 490,
  INDUSINDBK: 1450, DIVISLAB: 3800, HEROMOTOCO: 5100, APOLLOHOSP: 7200,
  EICHERMOT: 4900, BAJAJFINSV: 1850, POWERGRID: 340, JSWSTEEL: 980,
  HINDALCO: 680, TATASTEEL: 175, TATACONSUM: 1100, NESTLEIND: 2500,
  HDFCLIFE: 780, SBILIFE: 1650, ADANIENT: 3200, ADANIPORTS: 1450,
  BHARTIARTL: 1780, LTIM: 5800, 'BAJAJ-AUTO': 9200, 'M&M': 2900,
};

// ── In-memory cache ───────────────────────────────────────────────────────────

const _cache     = new Map();  // base → { price, source, timestamp, expiresAt }
const _simPrices = new Map();

function _cacheGet(base) {
  const e = _cache.get(base);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _cache.delete(base); return null; }
  return e;
}

function _cacheSet(base, price, source) {
  _cache.set(base, {
    price, source,
    timestamp:  new Date().toISOString(),
    expiresAt:  Date.now() + CACHE_TTL_MS,
  });
}

// ── Simulation fallback ───────────────────────────────────────────────────────

function _simPrice(base) {
  const seed = SEED_PRICES[base] || 1000;
  if (!_simPrices.has(base)) _simPrices.set(base, seed);
  const prev   = _simPrices.get(base);
  const change = prev * (0.003 * (Math.random() * 2 - 1) + 0.00005);
  const next   = parseFloat((prev + change).toFixed(2));
  _simPrices.set(base, next);
  return next;
}

// ── Provider 0: Upstox WS cache ───────────────────────────────────────────────

function _fetchUpstox(base) {
  const ws = _getUpstoxWS();
  if (!ws) throw new Error('Upstox WS module unavailable');

  const cached = ws.getCachedPrice(base);
  if (!cached) throw new Error(`No Upstox tick cached for ${base}`);

  const price = parseFloat(cached.price);
  if (!isFinite(price) || price <= 0) throw new Error(`Upstox cached price invalid: ${cached.price}`);

  logger.debug(`[MarketData] Upstox cache hit: ${base} = ₹${price}`);
  return price;
}

// ── Provider 1: NSE India ─────────────────────────────────────────────────────

const _nseClient = axios.create({
  baseURL: NSE_BASE_URL,
  timeout: TIMEOUT_MS,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://www.nseindia.com/get-quotes/equity',
  },
});

let _nseCookieJar    = '';
let _nseCookieExpiry = 0;

/** Prime NSE session cookies by hitting homepage (needed for /api/* calls). */
async function _primeNseCookies() {
  if (Date.now() < _nseCookieExpiry && _nseCookieJar) return;
  try {
    const res = await _nseClient.get('/', { timeout: TIMEOUT_MS });
    const setCookie = res.headers['set-cookie'];
    if (setCookie && setCookie.length) {
      _nseCookieJar = setCookie.map(c => c.split(';')[0]).join('; ');
      _nseCookieExpiry = Date.now() + 10 * 60 * 1000;  // 10 min
      logger.debug(`[MarketData] NSE cookies primed (${setCookie.length} cookies)`);
    }
  } catch (err) {
    logger.debug(`[MarketData] NSE cookie prime failed (non-fatal): ${err.message}`);
  }
}

/**
 * Fetch a single price from NSE India unofficial API.
 * @param {string} base  Canonical base symbol (e.g. "RELIANCE")
 * @returns {Promise<number>}  INR price
 */
async function _fetchNSE(base) {
  if (_cbOpen('nse')) throw new Error('NSE circuit breaker open');

  await _primeNseCookies();

  const url = `/api/quote-equity?symbol=${encodeURIComponent(base.toUpperCase())}`;
  logger.info(`[MarketData] NSE | ${base} | url="${url}"`);

  const response = await _nseClient.get(url, {
    headers: _nseCookieJar ? { Cookie: _nseCookieJar } : {},
  });

  const data = response.data;
  if (!data || !data.priceInfo) {
    _cbRecordFail('nse');
    throw new Error(`NSE: no priceInfo for ${base}`);
  }

  const price = parseFloat(data.priceInfo.lastPrice);
  if (!isFinite(price) || price <= 0) {
    _cbRecordFail('nse');
    throw new Error(`NSE invalid price for ${base}: "${data.priceInfo.lastPrice}"`);
  }

  _cbRecordSuccess('nse');
  logger.info(`[MarketData] ✅ NSE | ${base} = ₹${price} (LIVE_NSE)`);
  return price;
}

// ── Provider 2: TwelveData ────────────────────────────────────────────────────

async function _fetchTwelve(base) {
  if (!TWELVEDATA_KEY) throw new Error('TWELVEDATA_API_KEY not set');
  if (_cbOpen('twelvedata')) throw new Error('TwelveData circuit breaker open');

  const apiSymbol = symbolMap.toTwelve(base);
  logger.info(`[MarketData] TwelveData | ${base} | apiSymbol="${apiSymbol}"`);

  const response = await axios.get(`${TWELVEDATA_URL}/price`, {
    params: { symbol: apiSymbol, apikey: TWELVEDATA_KEY },
    timeout: TIMEOUT_MS,
  });

  const data = response.data;
  logger.debug(`[MarketData] TwelveData raw response for ${base}: ${JSON.stringify(data)}`);

  if (data.code !== undefined || data.status === 'error') {
    _cbRecordFail('twelvedata');
    throw new Error(`TwelveData error for ${apiSymbol}: ${data.message || JSON.stringify(data)}`);
  }

  const price = parseFloat(data.price);
  if (!isFinite(price) || price <= 0) {
    _cbRecordFail('twelvedata');
    throw new Error(`TwelveData invalid price for ${apiSymbol}: "${data.price}"`);
  }
  if (price < 10) {
    _cbRecordFail('twelvedata');
    throw new Error(`TwelveData price ₹${price} for ${apiSymbol} looks like USD ADR`);
  }

  _cbRecordSuccess('twelvedata');
  logger.info(`[MarketData] ✅ TwelveData | ${base} = ₹${price} (LIVE_TWELVE)`);
  return price;
}

// ── Provider 3: Finnhub ───────────────────────────────────────────────────────

async function _fetchFinnhub(base) {
  if (!FINNHUB_KEY) throw new Error('FINNHUB_API_KEY not set');
  if (_cbOpen('finnhub')) throw new Error('Finnhub circuit breaker open');

  const apiSymbol = symbolMap.toFinnhub(base);
  logger.info(`[MarketData] Finnhub | ${base} | apiSymbol="${apiSymbol}"`);

  const response = await axios.get(`${FINNHUB_URL}/quote`, {
    params: { symbol: apiSymbol, token: FINNHUB_KEY },
    timeout: TIMEOUT_MS,
  });

  const data = response.data;
  logger.debug(`[MarketData] Finnhub raw response for ${base}: ${JSON.stringify(data)}`);

  // Finnhub returns { error: "..." } when free tier doesn't cover NSE
  if (data.error) {
    _cbRecordFail('finnhub');
    throw new Error(`Finnhub: ${data.error}`);
  }

  const price = parseFloat(data.c);
  if (!isFinite(price) || price <= 0) {
    _cbRecordFail('finnhub');
    throw new Error(`Finnhub no price for ${apiSymbol}: c="${data.c}"`);
  }
  if (price < 10) {
    _cbRecordFail('finnhub');
    throw new Error(`Finnhub price ₹${price} for ${apiSymbol} looks like USD`);
  }

  _cbRecordSuccess('finnhub');
  logger.info(`[MarketData] ✅ Finnhub | ${base} = ₹${price} (LIVE_FINNHUB)`);
  return price;
}

// ── Main public API ───────────────────────────────────────────────────────────

/**
 * Get the latest price for a single symbol.
 * Chain: Upstox → NSE → TwelveData → Finnhub → SIM.
 * Never throws — always returns a price.
 */
async function getLivePrice(symbol) {
  const base = symbolMap.toBase(symbol);

  // Cache hit
  const cached = _cacheGet(base);
  if (cached) {
    logger.debug(`[MarketData] Cache hit | ${base} = ₹${cached.price} (${cached.source})`);
    return { symbol: base, price: cached.price, source: cached.source, timestamp: cached.timestamp };
  }

  // ── 0. Upstox WS ────────────────────────────────────────────────────────
  try {
    const price = _fetchUpstox(base);
    _cacheSet(base, price, 'LIVE_UPSTOX');
    logger.info(`[MarketData] ✅ Upstox | ${base} = ₹${price}`);
    return { symbol: base, price, source: 'LIVE_UPSTOX', timestamp: new Date().toISOString() };
  } catch (err) {
    logger.debug(`[MarketData] Upstox skip for ${base}: ${err.message}`);
  }

  // ── 1. NSE India ────────────────────────────────────────────────────────
  try {
    const price = await _fetchNSE(base);
    _cacheSet(base, price, 'LIVE_NSE');
    return { symbol: base, price, source: 'LIVE_NSE', timestamp: new Date().toISOString() };
  } catch (err) {
    logger.warn(`[MarketData] NSE failed for ${base}: ${err.message}`);
  }

  // ── 2. TwelveData ───────────────────────────────────────────────────────
  try {
    const price = await _fetchTwelve(base);
    _cacheSet(base, price, 'LIVE_TWELVE');
    return { symbol: base, price, source: 'LIVE_TWELVE', timestamp: new Date().toISOString() };
  } catch (err) {
    logger.warn(`[MarketData] TwelveData failed for ${base}: ${err.message}`);
  }

  // ── 3. Finnhub ──────────────────────────────────────────────────────────
  try {
    const price = await _fetchFinnhub(base);
    _cacheSet(base, price, 'LIVE_FINNHUB');
    return { symbol: base, price, source: 'LIVE_FINNHUB', timestamp: new Date().toISOString() };
  } catch (err) {
    logger.warn(`[MarketData] Finnhub failed for ${base}: ${err.message}`);
  }

  // ── 4. Simulation ───────────────────────────────────────────────────────
  const price = _simPrice(base);
  _cacheSet(base, price, 'SIM');
  logger.info(`[MarketData] SIM fallback | ${base} = ₹${price}`);
  return { symbol: base, price, source: 'SIM', timestamp: new Date().toISOString() };
}

/**
 * Batch prices — tries TwelveData batch first (if available),
 * then falls back per-symbol through full chain.
 */
async function getBatchPrices(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];

  const bases    = symbols.map(s => symbolMap.toBase(s));
  const results  = [];
  const uncached = [];

  for (const base of bases) {
    const cached = _cacheGet(base);
    if (cached) {
      results.push({ symbol: base, price: cached.price, source: cached.source, timestamp: cached.timestamp });
    } else {
      uncached.push(base);
    }
  }

  if (uncached.length === 0) return results;

  const remaining = [...uncached];

  // TwelveData batch — only if key exists AND breaker closed
  if (TWELVEDATA_KEY && !_cbOpen('twelvedata')) {
    for (let i = 0; i < uncached.length; i += BATCH_CHUNK) {
      const chunk      = uncached.slice(i, i + BATCH_CHUNK);
      const apiSymbols = chunk.map(b => symbolMap.toTwelve(b));
      const symbolStr  = apiSymbols.join(',');

      logger.info(`[MarketData] TwelveData batch | "${symbolStr}"`);

      try {
        const response = await axios.get(`${TWELVEDATA_URL}/price`, {
          params: { symbol: symbolStr, apikey: TWELVEDATA_KEY },
          timeout: TIMEOUT_MS,
        });

        const data = response.data;

        // If top-level error, trip breaker and bail out
        if (data.code !== undefined || data.status === 'error') {
          _cbRecordFail('twelvedata');
          logger.warn(`[MarketData] TwelveData batch error: ${data.message || JSON.stringify(data)}`);
          break;
        }

        for (let j = 0; j < chunk.length; j++) {
          const base      = chunk[j];
          const apiSymbol = apiSymbols[j];
          const item      = chunk.length === 1 ? data : data[apiSymbol];

          if (item && item.code === undefined && item.status !== 'error') {
            const price = parseFloat(item.price ?? item);
            if (isFinite(price) && price > 10) {
              _cacheSet(base, price, 'LIVE_TWELVE');
              results.push({ symbol: base, price, source: 'LIVE_TWELVE', timestamp: new Date().toISOString() });
              const idx = remaining.indexOf(base);
              if (idx >= 0) remaining.splice(idx, 1);
              logger.info(`[MarketData] ✅ TwelveData batch | ${base} = ₹${price}`);
            }
          }
        }
        _cbRecordSuccess('twelvedata');
      } catch (batchErr) {
        _cbRecordFail('twelvedata');
        logger.warn(`[MarketData] TwelveData batch failed: ${batchErr.message}`);
      }
    }
  } else if (_cbOpen('twelvedata')) {
    logger.debug('[MarketData] TwelveData batch skipped — circuit breaker open');
  }

  // Fall through per-symbol (Upstox → NSE → TwelveData → Finnhub → SIM)
  for (const base of remaining) {
    const result = await getLivePrice(base);
    results.push(result);
  }

  const counts = results.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + 1; return acc; }, {});
  logger.info(`[MarketData] Batch complete: ${JSON.stringify(counts)}`);

  return results;
}

// ── Health check ──────────────────────────────────────────────────────────────

async function healthCheck() {
  const result = {
    upstox:     { ok: false },
    nse:        { ok: false },
    twelvedata: { ok: false },
    finnhub:    { ok: false },
    overall:    false,
  };

  // Upstox
  try {
    const price = _fetchUpstox('INFY');
    result.upstox = { ok: true, price, message: `INFY = ₹${price}` };
  } catch (err) {
    result.upstox = { ok: false, message: err.message };
  }

  // NSE
  {
    const start = Date.now();
    try {
      const price = await _fetchNSE('INFY');
      result.nse = { ok: true, latencyMs: Date.now() - start, price, message: `INFY = ₹${price}` };
    } catch (err) {
      result.nse = { ok: false, latencyMs: Date.now() - start, message: err.message };
    }
  }

  // TwelveData
  if (TWELVEDATA_KEY) {
    const start = Date.now();
    try {
      const price = await _fetchTwelve('INFY');
      result.twelvedata = { ok: true, latencyMs: Date.now() - start, price, message: `INFY:NSE = ₹${price}` };
    } catch (err) {
      result.twelvedata = { ok: false, latencyMs: Date.now() - start, message: err.message };
    }
  } else {
    result.twelvedata = { ok: false, message: 'TWELVEDATA_API_KEY not set' };
  }

  // Finnhub
  if (FINNHUB_KEY) {
    const start = Date.now();
    try {
      const price = await _fetchFinnhub('INFY');
      result.finnhub = { ok: true, latencyMs: Date.now() - start, price, message: `NSE:INFY = ₹${price}` };
    } catch (err) {
      result.finnhub = { ok: false, latencyMs: Date.now() - start, message: err.message };
    }
  } else {
    result.finnhub = { ok: false, message: 'FINNHUB_API_KEY not set' };
  }

  result.overall = result.upstox.ok || result.nse.ok || result.twelvedata.ok || result.finnhub.ok;
  return result;
}

// ── Cache utilities ───────────────────────────────────────────────────────────

function clearCache(symbol = null) {
  if (symbol) _cache.delete(symbolMap.toBase(symbol));
  else        _cache.clear();
}

function getCacheStats() {
  const entries = [..._cache.values()];
  const ws      = _getUpstoxWS();
  return {
    size:          entries.length,
    liveUpstox:    entries.filter(e => e.source === 'LIVE_UPSTOX').length,
    liveNSE:       entries.filter(e => e.source === 'LIVE_NSE').length,
    liveTwelve:    entries.filter(e => e.source === 'LIVE_TWELVE').length,
    liveFinnhub:   entries.filter(e => e.source === 'LIVE_FINNHUB').length,
    sim:           entries.filter(e => e.source === 'SIM').length,
    ttlMs:         CACHE_TTL_MS,
    upstoxWS:      ws ? ws.getStatus() : { connected: false },
    nseCookies:    !!_nseCookieJar,
    twelvedataKey: !!TWELVEDATA_KEY,
    finnhubKey:    !!FINNHUB_KEY,
    breakers:      {
      twelvedata: { ..._breakers.twelvedata, open: _cbOpen('twelvedata') },
      finnhub:    { ..._breakers.finnhub,    open: _cbOpen('finnhub')    },
      nse:        { ..._breakers.nse,        open: _cbOpen('nse')        },
    },
  };
}

module.exports = {
  getLivePrice,
  getBatchPrices,
  healthCheck,
  clearCache,
  getCacheStats,
};
