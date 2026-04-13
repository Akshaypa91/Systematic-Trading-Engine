// src/services/marketDataService.js
// ─────────────────────────────────────────────────────────────────────────────
//
// MARKET DATA SERVICE — Unified Price Data Layer
// ─────────────────────────────────────────────────────────────────────────────
//
// Architecture:
//   1. Try Twelve Data API  → fast, free, reliable (500 req/day on free tier)
//   2. On failure          → log warning + fall back to Simulation Engine
//   3. Always return       → consistent normalised format
//
// Response format (always):
//   { symbol, price, source: "API"|"SIMULATION", timestamp }
//
// Caching:
//   All prices cached for CACHE_TTL_MS (default 8s) to stay well within
//   Twelve Data's free-tier rate limit of ~8 req/min per symbol.
//
// Usage:
//   const mds = require('./marketDataService');
//   const { price, source } = await mds.getLivePrice('INFY');
//   const results = await mds.getBatchPrices(['INFY', 'TCS', 'RELIANCE']);
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const axios   = require('axios');
const logger  = require('../config/logger');

// ── Config ────────────────────────────────────────────────────────────────────

const TWELVEDATA_API_KEY  = process.env.TWELVEDATA_API_KEY || '';
const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com';
const CACHE_TTL_MS        = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || '8000', 10);
const API_TIMEOUT_MS      = parseInt(process.env.MARKET_DATA_TIMEOUT_MS   || '8000', 10);

// Twelve Data free tier: ~8 requests/min. We cache 8s so worst case is
// 60s / 8s = 7.5 fetches/min — safely under the limit.
const BATCH_CHUNK_SIZE    = 5;   // max symbols per batch request (conservative)

// ── Seed prices (simulation fallback baseline — INR) ─────────────────────────
// These match the simulation engine's SEED_PRICES for consistency.
const FALLBACK_SEED_PRICES = {
  RELIANCE:    2850,  INFY:        1620,  TCS:         4200,  HDFCBANK:    1720,
  ICICIBANK:   1180,  WIPRO:        560,  SBIN:         810,  AXISBANK:    1190,
  BAJFINANCE:  6800,  MARUTI:     12500,  TATAMOTORS:   960,  SUNPHARMA:  1650,
  TECHM:       1740,  TITAN:       3450,  ULTRACEMCO:  10200, LT:          3700,
  HINDUNILVR:  2480,  KOTAKBANK:  1940,  ASIANPAINT:  2850,  ONGC:         290,
};

// ── In-memory price cache ─────────────────────────────────────────────────────
// key: symbol  →  value: { price, source, timestamp, expiresAt }
const _cache = new Map();

function _cacheGet(symbol) {
  const entry = _cache.get(symbol);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(symbol); return null; }
  return entry;
}

function _cacheSet(symbol, price, source) {
  _cache.set(symbol, {
    symbol,
    price,
    source,
    timestamp:  new Date().toISOString(),
    expiresAt:  Date.now() + CACHE_TTL_MS,
  });
}

// ── Simulation fallback ───────────────────────────────────────────────────────
// Uses a simple GBM step so repeated calls produce realistic drift,
// matching the simulation engine's behaviour without depending on it directly.

const _simPrices = new Map();  // per-symbol floating price for fallback

function _getSimulatedPrice(symbol) {
  const base = FALLBACK_SEED_PRICES[symbol] || 1000;

  if (!_simPrices.has(symbol)) {
    _simPrices.set(symbol, base);
  }

  // Tiny random walk step (±0.3%)
  const prev   = _simPrices.get(symbol);
  const change = prev * (0.003 * (Math.random() * 2 - 1) + 0.00005);
  const next   = parseFloat((prev + change).toFixed(2));
  _simPrices.set(symbol, next);
  return next;
}

// ── Twelve Data API helpers ───────────────────────────────────────────────────

/**
 * Fetch a single symbol price from Twelve Data /price endpoint.
 * Always appends :NSE exchange suffix to get INR prices, not US ADR prices.
 * Returns the parsed numeric price or throws on error.
 */
async function _fetchSingleFromAPI(symbol) {
  if (!TWELVEDATA_API_KEY) {
    throw new Error('TWELVEDATA_API_KEY not configured');
  }

  // Always use :NSE suffix — without it Twelve Data returns the US-listed
  // ADR in USD (e.g. INFY = $13.69) instead of NSE INR price (~1620)
  const nseSymbol = symbol.includes(':') ? symbol : `${symbol}:NSE`;

  const response = await axios.get(`${TWELVEDATA_BASE_URL}/price`, {
    params: {
      symbol:  nseSymbol,
      apikey:  TWELVEDATA_API_KEY,
    },
    timeout: API_TIMEOUT_MS,
  });

  const data = response.data;

  // Twelve Data error responses: { "code": 400, "message": "..." }
  if (data.code || data.status === 'error') {
    throw new Error(`Twelve Data error [${nseSymbol}]: ${data.message || JSON.stringify(data)}`);
  }

  const price = parseFloat(data.price);
  if (!price || isNaN(price)) {
    throw new Error(`Invalid price value for ${nseSymbol}: ${JSON.stringify(data)}`);
  }

  // Sanity check: NSE INR prices are always > 10 (rejects accidental USD ADR prices)
  if (price < 10) {
    throw new Error(`Price ${price} for ${nseSymbol} looks like USD ADR — rejecting, expected INR`);
  }

  return price;
}

/**
 * Fetch multiple symbols in one API call using Twelve Data's batch endpoint.
 * Symbols are comma-joined: e.g. "INFY,TCS,RELIANCE"
 * Returns Map<symbol, price>.
 */
async function _fetchBatchFromAPI(symbols) {
  if (!TWELVEDATA_API_KEY) {
    throw new Error('TWELVEDATA_API_KEY not configured');
  }

  // Twelve Data accepts comma-separated symbols for batch price requests
  // For Indian NSE stocks, append :NSE exchange suffix for accuracy
  const symbolStr = symbols.map(s => `${s}:NSE`).join(',');

  const response = await axios.get(`${TWELVEDATA_BASE_URL}/price`, {
    params: {
      symbol: symbolStr,
      apikey: TWELVEDATA_API_KEY,
    },
    timeout: API_TIMEOUT_MS,
  });

  const data = response.data;

  // Batch response is an object: { "INFY:NSE": { price: "1620.50" }, ... }
  // Single symbol response is just: { price: "1620.50" }
  const results = new Map();

  if (symbols.length === 1) {
    // Single symbol — normalise to map format
    if (data.price && !data.code) {
      results.set(symbols[0], parseFloat(data.price));
    }
  } else {
    for (const sym of symbols) {
      const key  = `${sym}:NSE`;
      const item = data[key];
      if (item && item.price && !item.code) {
        results.set(sym, parseFloat(item.price));
      }
    }
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the latest price for a single symbol.
 *
 * Flow:
 *   1. Check in-memory cache (8s TTL)
 *   2. Try Twelve Data API
 *   3. On any failure → log warning → return simulation price
 *
 * @param {string} symbol - NSE symbol, e.g. 'INFY'
 * @returns {Promise<{ symbol, price, source, timestamp }>}
 */
async function getLivePrice(symbol) {
  const sym = symbol.toUpperCase().trim();

  // 1. Cache hit
  const cached = _cacheGet(sym);
  if (cached) {
    logger.debug(`[MarketData] Cache hit: ${sym} = ₹${cached.price} (${cached.source})`);
    return { symbol: sym, price: cached.price, source: cached.source, timestamp: cached.timestamp };
  }

  // 2. Try API
  try {
    const price = await _fetchSingleFromAPI(sym);
    _cacheSet(sym, price, 'API');
    logger.info(`[MarketData] ✅ API success: ${sym} = ₹${price}`);
    return { symbol: sym, price, source: 'API', timestamp: new Date().toISOString() };

  } catch (apiErr) {
    // 3. Fallback to simulation
    logger.warn(`[MarketData] ⚠️  API failed for ${sym}: ${apiErr.message} → using SIMULATION`);
    const price = _getSimulatedPrice(sym);
    _cacheSet(sym, price, 'SIMULATION');
    logger.info(`[MarketData] 🔄 Simulation fallback: ${sym} = ₹${price}`);
    return { symbol: sym, price, source: 'SIMULATION', timestamp: new Date().toISOString() };
  }
}

/**
 * Get prices for multiple symbols efficiently.
 * Splits into cached hits + uncached, then fetches uncached in batch chunks.
 *
 * @param {string[]} symbols - Array of NSE symbols
 * @returns {Promise<Array<{ symbol, price, source, timestamp }>>}
 */
async function getBatchPrices(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];

  const syms      = symbols.map(s => s.toUpperCase().trim());
  const results   = [];
  const uncached  = [];

  // Split: return cached hits immediately, collect uncached for API
  for (const sym of syms) {
    const cached = _cacheGet(sym);
    if (cached) {
      results.push({ symbol: sym, price: cached.price, source: cached.source, timestamp: cached.timestamp });
    } else {
      uncached.push(sym);
    }
  }

  if (uncached.length === 0) {
    logger.debug(`[MarketData] Batch: all ${syms.length} symbols from cache`);
    return results;
  }

  // Process uncached in chunks to avoid API overload
  for (let i = 0; i < uncached.length; i += BATCH_CHUNK_SIZE) {
    const chunk = uncached.slice(i, i + BATCH_CHUNK_SIZE);

    try {
      const apiResults = await _fetchBatchFromAPI(chunk);

      for (const sym of chunk) {
        if (apiResults.has(sym)) {
          const price = apiResults.get(sym);
          _cacheSet(sym, price, 'API');
          results.push({ symbol: sym, price, source: 'API', timestamp: new Date().toISOString() });
          logger.info(`[MarketData] ✅ API batch success: ${sym} = ₹${price}`);
        } else {
          // API returned but this symbol was missing → simulate
          throw new Error(`Symbol ${sym} not found in batch response`);
        }
      }

    } catch (apiErr) {
      // Batch failed — fall back each symbol individually to simulation
      logger.warn(`[MarketData] ⚠️  Batch API failed (chunk ${Math.floor(i / BATCH_CHUNK_SIZE) + 1}): ${apiErr.message} → using SIMULATION for chunk`);

      for (const sym of chunk) {
        // Only simulate if we don't already have it (partial batch success case)
        if (!results.find(r => r.symbol === sym)) {
          const price = _getSimulatedPrice(sym);
          _cacheSet(sym, price, 'SIMULATION');
          results.push({ symbol: sym, price, source: 'SIMULATION', timestamp: new Date().toISOString() });
          logger.info(`[MarketData] 🔄 Simulation fallback: ${sym} = ₹${price}`);
        }
      }
    }
  }

  const apiCount = results.filter(r => r.source === 'API').length;
  const simCount = results.filter(r => r.source === 'SIMULATION').length;
  logger.info(`[MarketData] Batch complete: ${apiCount} from API, ${simCount} from simulation (total: ${results.length})`);

  return results;
}

/**
 * Check whether the Twelve Data API is reachable and the key is valid.
 * Returns { ok: boolean, latencyMs: number, message: string }
 */
async function healthCheck() {
  if (!TWELVEDATA_API_KEY) {
    return { ok: false, latencyMs: 0, message: 'TWELVEDATA_API_KEY not set — running in SIMULATION-only mode' };
  }

  const start = Date.now();
  try {
    // Use INFY:NSE explicitly — plain INFY returns the US ADR in USD
    const price = await _fetchSingleFromAPI('INFY:NSE');
    return {
      ok:        true,
      latencyMs: Date.now() - start,
      message:   `API reachable. INFY:NSE = \u20b9${price}`,
    };
  } catch (err) {
    return {
      ok:        false,
      latencyMs: Date.now() - start,
      message:   `API unreachable: ${err.message}`,
    };
  }
}

/**
 * Clear the internal price cache (useful for testing or forcing refresh).
 */
function clearCache() {
  _cache.clear();
  logger.debug('[MarketData] Cache cleared');
}

/**
 * Get cache stats for monitoring/debug endpoints.
 */
function getCacheStats() {
  const entries = [..._cache.values()];
  return {
    size:       entries.length,
    apiEntries: entries.filter(e => e.source === 'API').length,
    simEntries: entries.filter(e => e.source === 'SIMULATION').length,
    ttlMs:      CACHE_TTL_MS,
    apiKeySet:  !!TWELVEDATA_API_KEY,
  };
}

module.exports = {
  getLivePrice,
  getBatchPrices,
  healthCheck,
  clearCache,
  getCacheStats,
};