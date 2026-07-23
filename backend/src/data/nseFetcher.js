// src/data/nseFetcher.js
// NSE data fetcher — handles cookies, retries, rate limiting, and caching
// NSE actively blocks scrapers; this module mimics a real browser session.

'use strict';

const axios   = require('axios');
const logger  = require('../config/logger');
const C       = require('../config/constants');

// ─── In-memory cache ─────────────────────────────────────────────────────────
// Simple TTL map — replace with Redis in a multi-process deployment
const cache = new Map();   // key → { data, expiresAt }

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ─── Rate limiter (token bucket) ─────────────────────────────────────────────
// Allows burst up to RPM limit, then throttles to 1 req / (60000/RPM) ms
class TokenBucket {
  constructor(ratePerMinute) {
    this.capacity  = ratePerMinute;
    this.tokens    = ratePerMinute;
    this.interval  = 60_000 / ratePerMinute;   // ms per token
    this.lastRefill = Date.now();
  }
  async consume() {
    // Iterative wait — avoids potential stack overflow under sustained rate limiting
    while (true) {
      const now      = Date.now();
      const refilled = Math.floor((now - this.lastRefill) / this.interval);
      if (refilled > 0) {
        this.tokens     = Math.min(this.capacity, this.tokens + refilled);
        this.lastRefill = now;
      }
      if (this.tokens >= 1) { this.tokens--; return; }
      const wait = this.interval - (now - this.lastRefill);
      await new Promise(r => setTimeout(r, Math.max(wait, 0) + 50));
    }
  }
}

const rateLimiter = new TokenBucket(C.NSE.RATE_LIMIT_RPM);

// ─── Cookie / session management ─────────────────────────────────────────────
let _nseSession = { cookies: '', refreshedAt: 0 };

/**
 * Hit the NSE homepage to acquire session cookies.
 * NSE requires valid cookies to access its API endpoints.
 */
async function refreshNseSession() {
  try {
    const res = await axios.get(C.NSE.BASE_URL, {
      timeout: C.NSE.TIMEOUT_MS,
      headers: buildBaseHeaders(),
      maxRedirects: 5,
    });
    const rawCookies = res.headers['set-cookie'] || [];
    _nseSession.cookies = rawCookies.map(c => c.split(';')[0]).join('; ');
    _nseSession.refreshedAt = Date.now();
    logger.info('[NSE] Session cookies refreshed');
  } catch (err) {
    logger.warn(`[NSE] Cookie refresh failed: ${err.message}`);
  }
}

function buildBaseHeaders(overrides = {}) {
  const ua = C.NSE.USER_AGENTS[Math.floor(Math.random() * C.NSE.USER_AGENTS.length)];
  return {
    'User-Agent':       ua,
    'Accept':           'application/json, text/plain, */*',
    'Accept-Language':  'en-US,en;q=0.9',
    'Accept-Encoding':  'gzip, deflate, br',
    'Referer':          `${C.NSE.BASE_URL}/get-quotes/equity`,
    'X-Requested-With': 'XMLHttpRequest',
    'Cache-Control':    'no-cache',
    'Pragma':           'no-cache',
    'Connection':       'keep-alive',
    ...(overrides),
  };
}

function buildApiHeaders() {
  // Refresh cookies if they're older than COOKIE_REFRESH_MS
  const age = Date.now() - _nseSession.refreshedAt;
  if (age > C.NSE.COOKIE_REFRESH_MS) {
    // Non-blocking refresh — will take effect on next request
    refreshNseSession().catch(() => {});
  }
  return {
    ...buildBaseHeaders(),
    Cookie: _nseSession.cookies,
  };
}

// ─── Core HTTP request with retry ────────────────────────────────────────────
/**
 * Sends a GET request to a full URL with retry logic and rate limiting.
 *
 * @param {string} url
 * @param {Object} params  - Query parameters
 * @param {number} attempt - Internal recursion counter
 * @returns {Promise<any>} Parsed response data
 */
async function fetchWithRetry(url, params = {}, attempt = 1) {
  await rateLimiter.consume();

  try {
    const res = await axios.get(url, {
      params,
      headers: buildApiHeaders(),
      timeout: C.NSE.TIMEOUT_MS,
    });
    return res.data;

  } catch (err) {
    const isRetryable = !err.response || [429, 500, 502, 503, 504].includes(err.response?.status);
    const status      = err.response?.status;

    if (status === 401 || status === 403) {
      logger.warn('[NSE] Auth/block response — refreshing session');
      await refreshNseSession();
    }

    if (attempt < C.NSE.RETRY_ATTEMPTS && isRetryable) {
      const delay = C.NSE.RETRY_DELAY_MS * attempt;   // Linear back-off
      logger.warn(`[NSE] Retry ${attempt}/${C.NSE.RETRY_ATTEMPTS} for ${url} in ${delay}ms (status: ${status || err.code})`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, params, attempt + 1);
    }

    throw new Error(`NSE fetch failed after ${attempt} attempt(s) [${url}]: ${err.message}`);
  }
}

// ─── Public API methods ───────────────────────────────────────────────────────

/**
 * Fetch quote + OHLC for a given NSE symbol.
 * Returns a normalised object with OHLCV data.
 *
 * @param {string} symbol - e.g. 'RELIANCE', 'INFY'
 * @returns {Promise<Object>}
 */
async function getQuote(symbol) {
  const cacheKey = `quote:${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchWithRetry(`${C.NSE.API_BASE}/quote-equity`, { symbol });

  const priceInfo = data?.priceInfo ?? {};
  const ohlc      = priceInfo?.intraDayHighLow ?? {};
  const result = {
    symbol,
    lastPrice:  priceInfo.lastPrice,
    open:       priceInfo.open,
    high:       ohlc.max  || priceInfo.dayHigh,
    low:        ohlc.min  || priceInfo.dayLow,
    close:      priceInfo.previousClose,
    change:     priceInfo.change,
    changePct:  priceInfo.pChange,
    volume:     data?.securityWiseDP?.quantityTraded,
    vwap:       priceInfo.vwap,
    weekHigh52: priceInfo.weekHighLow?.max,
    weekLow52:  priceInfo.weekHighLow?.min,
    fetchedAt:  new Date().toISOString(),
  };

  cacheSet(cacheKey, result, C.CACHE.MARKET_TTL_S * 1000);
  return result;
}

/**
 * Fetch historical EOD data for a symbol.
 * Uses NSE's historical data endpoint; returns array sorted ascending by date.
 *
 * @param {string} symbol
 * @param {string} fromDate - 'DD-MM-YYYY'
 * @param {string} toDate   - 'DD-MM-YYYY'
 * @returns {Promise<Array<Object>>}
 */
async function getHistoricalData(symbol, fromDate, toDate) {
  const cacheKey = `hist:${symbol}:${fromDate}:${toDate}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchWithRetry(`${C.NSE.API_BASE}/historical/cm/equity`, {
    symbol,
    series: '["EQ"]',
    from:   fromDate,
    to:     toDate,
  });

  if (!data?.data || !Array.isArray(data.data)) {
    logger.warn(`[NSE] No historical data returned for ${symbol}`);
    return [];
  }

  // Normalise and sort ascending
  const result = data.data
    .map(row => ({
      symbol,
      date:       row.CH_TIMESTAMP || row.mTIMESTAMP,
      open:       parseFloat(row.CH_OPENING_PRICE),
      high:       parseFloat(row.CH_TRADE_HIGH_PRICE),
      low:        parseFloat(row.CH_TRADE_LOW_PRICE),
      close:      parseFloat(row.CH_CLOSING_PRICE),
      vwap:       parseFloat(row.CH_LAST_TRADED_PRICE || row.CH_CLOSING_PRICE),
      volume:     parseInt(row.CH_TOT_TRADED_QTY || 0, 10),
      deliveryQty:parseInt(row.COP_DELIV_QTY || 0, 10),
      deliveryPct:parseFloat(row.COP_DELIV_PERC || 0),
      trades:     parseInt(row.CH_TOTAL_TRADES || 0, 10),
      prevClose:  parseFloat(row.CH_PREVIOUS_CLS_PRICE || 0),
    }))
    .filter(r => r.close > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  cacheSet(cacheKey, result, C.CACHE.DEFAULT_TTL_S * 1000);
  logger.info(`[NSE] Historical data: ${result.length} rows for ${symbol} (${fromDate} → ${toDate})`);
  return result;
}

/**
 * Fetch all NIFTY 50 constituents with current quotes.
 * @returns {Promise<Array<Object>>}
 */
async function getNifty50Quotes() {
  const cacheKey = 'nifty50:quotes';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchWithRetry(`${C.NSE.API_BASE}/equity-stockIndices`, {
    index: 'NIFTY 50',
  });

  const result = (data?.data || []).map(stock => ({
    symbol:    stock.symbol,
    lastPrice: stock.lastPrice,
    open:      stock.open,
    high:      stock.dayHigh,
    low:       stock.dayLow,
    close:     stock.previousClose,
    changePct: stock.pChange,
    volume:    stock.totalTradedVolume,
    marketCap: stock.ffmc,
  }));

  cacheSet(cacheKey, result, C.CACHE.MARKET_TTL_S * 1000);
  return result;
}

/**
 * Fetch market status (open/close/pre-open).
 */
async function getMarketStatus() {
  return fetchWithRetry(`${C.NSE.API_BASE}/marketStatus`);
}

// Kick off initial session on module load
refreshNseSession().catch(() => {});

/**
 * Fetch corporate actions (splits / bonuses / dividends) for a symbol.
 * Returns NSE's raw array of { symbol, subject, exDate, ... }.
 * @param {string} symbol
 */
async function getCorporateActions(symbol) {
  return fetchWithRetry(`${C.NSE.API_BASE}/corporates-corporateActions`, {
    index: 'equities',
    symbol,
  });
}

module.exports = {
  getQuote,
  getHistoricalData,
  getNifty50Quotes,
  getMarketStatus,
  getCorporateActions,
  refreshNseSession,
};
