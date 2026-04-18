// src/services/marketDataService.js
// ─────────────────────────────────────────────────────────────────────────────
//
// MARKET DATA SERVICE — Multi-API fallback price feed
//
// PRIORITY CHAIN (per symbol, per request):
//   0. Upstox WS cache (real-time tick, <1s latency) → source: "LIVE_UPSTOX"
//   1. TwelveData REST (free tier: ~8 req/min)        → source: "LIVE_TWELVE"
//   2. Finnhub REST    (free tier: 60 req/min)        → source: "LIVE_FINNHUB"
//   3. Simulation      (GBM random walk)              → source: "SIM"
//
// Upstox requires OAuth — falls through to TwelveData if not authenticated.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const axios     = require('axios');
const symbolMap = require('../config/symbolMap');
const logger    = require('../config/logger');

// Upstox WS cache — lazy require to avoid circular dep at module load time
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

const CACHE_TTL_MS    = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || '8000',  10);
const TIMEOUT_MS      = parseInt(process.env.MARKET_DATA_TIMEOUT_MS   || '6000',  10);
const BATCH_CHUNK     = 5;  // max symbols per TwelveData batch call

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

// ── In-memory price cache ─────────────────────────────────────────────────────

// symbol (base) → { price, source, timestamp, expiresAt }
const _cache    = new Map();
// per-symbol floating sim price
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

// ── Provider 0: Upstox WebSocket cache ───────────────────────────────────────

/**
 * Read the latest price from the Upstox WS cache.
 * No network call — uses tick data already received on the WS connection.
 * Fast (<1ms), zero API quota used.
 *
 * @param {string} base  Canonical base symbol
 * @returns {number}     INR price
 * @throws if no cached price available
 */
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

// ── Provider 1: TwelveData ────────────────────────────────────────────────────

/**
 * Fetch a single price from Twelve Data.
 * Symbol format: SYMBOL:NSE  (e.g. TCS:NSE)
 *
 * @param {string} base  Canonical base symbol
 * @returns {Promise<number>}  INR price
 * @throws on any API error or invalid response
 */
async function _fetchTwelve(base) {
  if (!TWELVEDATA_KEY) throw new Error('TWELVEDATA_API_KEY not set');

  const apiSymbol = symbolMap.toTwelve(base);
  logger.info(`[MarketData] TwelveData | ${base} | apiSymbol="${apiSymbol}"`);

  const response = await axios.get(`${TWELVEDATA_URL}/price`, {
    params: { symbol: apiSymbol, apikey: TWELVEDATA_KEY },
    timeout: TIMEOUT_MS,
  });

  const data = response.data;
  logger.debug(`[MarketData] TwelveData raw response for ${base}: ${JSON.stringify(data)}`);

  // Error detection: valid response has no "code" field
  // data.code = 400/401/429 etc are errors; code = 0 is also an error (falsy — use !== undefined)
  if (data.code !== undefined || data.status === 'error') {
    throw new Error(`TwelveData error for ${apiSymbol}: ${data.message || JSON.stringify(data)}`);
  }

  const price = parseFloat(data.price);
  if (!isFinite(price) || price <= 0) {
    throw new Error(`TwelveData invalid price for ${apiSymbol}: "${data.price}"`);
  }
  // Sanity: NSE INR prices > ₹10; reject if it looks like a USD ADR
  if (price < 10) {
    throw new Error(`TwelveData price ₹${price} for ${apiSymbol} looks like USD ADR`);
  }

  logger.info(`[MarketData] ✅ TwelveData | ${base} = ₹${price} (LIVE_TWELVE)`);
  return price;
}

// ── Provider 2: Finnhub ───────────────────────────────────────────────────────

/**
 * Fetch a single price from Finnhub /quote endpoint.
 * Symbol format: NSE:SYMBOL  (e.g. NSE:TCS)
 * Uses field "c" (current price) from Finnhub quote response.
 *
 * @param {string} base  Canonical base symbol
 * @returns {Promise<number>}  INR price
 * @throws on any API error or invalid response
 */
async function _fetchFinnhub(base) {
  if (!FINNHUB_KEY) throw new Error('FINNHUB_API_KEY not set');

  const apiSymbol = symbolMap.toFinnhub(base);
  logger.info(`[MarketData] Finnhub | ${base} | apiSymbol="${apiSymbol}"`);

  const response = await axios.get(`${FINNHUB_URL}/quote`, {
    params: { symbol: apiSymbol, token: FINNHUB_KEY },
    timeout: TIMEOUT_MS,
  });

  const data  = response.data;
  logger.debug(`[MarketData] Finnhub raw response for ${base}: ${JSON.stringify(data)}`);

  // Finnhub returns { c: currentPrice, h, l, o, pc, t }
  // c = 0 means no data (market closed or symbol not found)
  const price = parseFloat(data.c);
  if (!isFinite(price) || price <= 0) {
    throw new Error(`Finnhub no price for ${apiSymbol}: c="${data.c}"`);
  }
  if (price < 10) {
    throw new Error(`Finnhub price ₹${price} for ${apiSymbol} looks like USD`);
  }

  logger.info(`[MarketData] ✅ Finnhub | ${base} = ₹${price} (LIVE_FINNHUB)`);
  return price;
}

// ── Main public API ───────────────────────────────────────────────────────────

/**
 * Get the latest price for a single symbol.
 * Tries TwelveData → Finnhub → Simulation in order.
 * Never throws — always returns a price.
 *
 * @param {string} symbol  Any format (TCS, NSE:TCS, TCS:NSE, etc.)
 * @returns {Promise<{ symbol, price, source, timestamp }>}
 *   source: "LIVE_TWELVE" | "LIVE_FINNHUB" | "SIM"
 */
async function getLivePrice(symbol) {
  const base = symbolMap.toBase(symbol);

  // Cache hit
  const cached = _cacheGet(base);
  if (cached) {
    logger.debug(`[MarketData] Cache hit | ${base} = ₹${cached.price} (${cached.source})`);
    return { symbol: base, price: cached.price, source: cached.source, timestamp: cached.timestamp };
  }

  // ── Provider 0: Upstox WS cache (real-time, zero network cost) ───────────
  try {
    const price = _fetchUpstox(base);
    _cacheSet(base, price, 'LIVE_UPSTOX');
    logger.info(`[MarketData] ✅ Upstox | ${base} = ₹${price}`);
    return { symbol: base, price, source: 'LIVE_UPSTOX', timestamp: new Date().toISOString() };
  } catch (err0) {
    // Not authenticated or symbol not subscribed — fall through silently
    logger.debug(`[MarketData] Upstox skip for ${base}: ${err0.message}`);
  }

  // ── Provider 1: TwelveData ───────────────────────────────────────────────
  try {
    const price = await _fetchTwelve(base);
    _cacheSet(base, price, 'LIVE_TWELVE');
    return { symbol: base, price, source: 'LIVE_TWELVE', timestamp: new Date().toISOString() };
  } catch (err1) {
    logger.warn(`[MarketData] TwelveData failed for ${base}: ${err1.message}`);
  }

  // ── Provider 2: Finnhub ──────────────────────────────────────────────────
  try {
    const price = await _fetchFinnhub(base);
    _cacheSet(base, price, 'LIVE_FINNHUB');
    return { symbol: base, price, source: 'LIVE_FINNHUB', timestamp: new Date().toISOString() };
  } catch (err2) {
    logger.warn(`[MarketData] Finnhub failed for ${base}: ${err2.message}`);
  }

  // ── Provider 3: Simulation fallback ────────────────────────────────────
  const price = _simPrice(base);
  _cacheSet(base, price, 'SIM');
  logger.info(`[MarketData] SIM fallback | ${base} = ₹${price}`);
  return { symbol: base, price, source: 'SIM', timestamp: new Date().toISOString() };
}

/**
 * Get prices for multiple symbols efficiently.
 * Uses TwelveData batch endpoint for uncached symbols, then falls back
 * per-symbol through the full chain.
 *
 * @param {string[]} symbols  Any formats
 * @returns {Promise<Array<{ symbol, price, source, timestamp }>>}
 */
async function getBatchPrices(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];

  const bases   = symbols.map(s => symbolMap.toBase(s));
  const results = [];
  const uncached = [];

  // Serve cache hits immediately
  for (const base of bases) {
    const cached = _cacheGet(base);
    if (cached) {
      results.push({ symbol: base, price: cached.price, source: cached.source, timestamp: cached.timestamp });
    } else {
      uncached.push(base);
    }
  }

  if (uncached.length === 0) return results;

  // Try TwelveData batch for uncached symbols
  const remaining = [...uncached];

  if (TWELVEDATA_KEY) {
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

        for (let j = 0; j < chunk.length; j++) {
          const base      = chunk[j];
          const apiSymbol = apiSymbols[j];

          // Single-symbol response: { price: "..." }
          // Multi-symbol response:  { "TCS:NSE": { price: "..." }, ... }
          const item = chunk.length === 1 ? data : data[apiSymbol];

          if (item && item.code === undefined && item.status !== 'error') {
            const price = parseFloat(item.price ?? item);
            if (isFinite(price) && price > 10) {
              _cacheSet(base, price, 'LIVE_TWELVE');
              results.push({ symbol: base, price, source: 'LIVE_TWELVE', timestamp: new Date().toISOString() });
              remaining.splice(remaining.indexOf(base), 1);
              logger.info(`[MarketData] ✅ TwelveData batch | ${base} = ₹${price}`);
            } else {
              logger.warn(`[MarketData] TwelveData batch invalid price for ${base}: "${item.price}"`);
            }
          } else {
            logger.warn(`[MarketData] TwelveData batch error for ${base}:`, item);
          }
        }
      } catch (batchErr) {
        logger.warn(`[MarketData] TwelveData batch failed: ${batchErr.message}`);
      }
    }
  }

  // Any still-uncached: fall through getLivePrice chain (Finnhub → SIM)
  for (const base of remaining) {
    const result = await getLivePrice(base);
    results.push(result);
  }

  const liveTwelve  = results.filter(r => r.source === 'LIVE_TWELVE').length;
  const liveFinnhub = results.filter(r => r.source === 'LIVE_FINNHUB').length;
  const sim         = results.filter(r => r.source === 'SIM').length;
  logger.info(
    `[MarketData] Batch complete: ${liveTwelve} LIVE_TWELVE, ${liveFinnhub} LIVE_FINNHUB, ${sim} SIM`
  );

  return results;
}

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * Check connectivity of all configured providers.
 * @returns {Promise<{ twelvedata, finnhub, overall }>}
 */
async function healthCheck() {
  const result = { twelvedata: { ok: false }, finnhub: { ok: false }, overall: false };

  // Test TwelveData with INFY
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

  // Test Finnhub with INFY
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

  result.overall = result.twelvedata.ok || result.finnhub.ok;
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
    liveTwelve:    entries.filter(e => e.source === 'LIVE_TWELVE').length,
    liveFinnhub:   entries.filter(e => e.source === 'LIVE_FINNHUB').length,
    sim:           entries.filter(e => e.source === 'SIM').length,
    ttlMs:         CACHE_TTL_MS,
    upstoxWS:      ws ? ws.getStatus() : { connected: false },
    twelvedataKey: !!TWELVEDATA_KEY,
    finnhubKey:    !!FINNHUB_KEY,
  };
}

module.exports = {
  getLivePrice,
  getBatchPrices,
  healthCheck,
  clearCache,
  getCacheStats,
};
