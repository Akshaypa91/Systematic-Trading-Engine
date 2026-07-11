// src/controllers/dataController.js
// ─────────────────────────────────────────────────────────────────────────────
// Data Controller — all market data now flows through marketDataService.
// NSE scraping (403-prone) replaced with Twelve Data API + simulation fallback.
// Existing API routes (/api/data/*) and response shapes are UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const marketDataService = require('../services/marketDataService');
const dataStore         = require('../data/dataStore');
const stockMaster       = require('../data/stockMaster');
const logger            = require('../config/logger');

// Default NIFTY-50 watchlist used when getNifty50 is called
const NIFTY50_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'BAJFINANCE', 'SBIN', 'BHARTIARTL', 'KOTAKBANK',
  'LT', 'AXISBANK', 'WIPRO', 'ASIANPAINT', 'MARUTI',
  'TITAN', 'TECHM', 'SUNPHARMA', 'ULTRACEMCO', 'ONGC',
  'TATAMOTORS', 'POWERGRID', 'NTPC', 'HCLTECH', 'JSWSTEEL',
  'TATASTEEL', 'INDUSINDBK', 'ADANIENT', 'ADANIPORTS', 'BAJAJFINSV',
  'BPCL', 'BRITANNIA', 'CIPLA', 'COALINDIA', 'DIVISLAB',
  'DRREDDY', 'EICHERMOT', 'GRASIM', 'HDFCLIFE', 'HEROMOTOCO',
  'HINDALCO', 'IOC', 'ITC', 'M&M', 'NESTLEIND',
  'SBILIFE', 'SHREECEM', 'TATACONSUM', 'UPL', 'VEDL',
];

/**
 * GET /api/data/quote/:symbol
 * Returns latest price via marketDataService (Twelve Data API → simulation fallback).
 * Response shape preserved for backward compatibility.
 */
async function getQuote(req, res) {
  try {
    const { symbol } = req.params;
    const result = await marketDataService.getLivePrice(symbol.toUpperCase());

    // Normalise to shape the frontend/tests expect (mirrors old nseFetcher.getQuote output)
    res.json({
      success: true,
      data: {
        symbol:    result.symbol,
        lastPrice: result.price,
        price:     result.price,
        source:    result.source,
        fetchedAt: result.timestamp,
        // OHLC not available on Twelve Data free /price endpoint
        open: null, high: null, low: null,
        change: null, changePct: null,
        volume: null, vwap: null,
      },
    });
  } catch (err) {
    logger.error(`[DataCtrl] getQuote error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/historical/:symbol?from=DD-MM-YYYY&to=DD-MM-YYYY
 * Reads from DB (dataStore). Historical data must be seeded via fetch-and-store first.
 */
async function getHistorical(req, res) {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from and to query params required (DD-MM-YYYY)' });
    }
    const data = await dataStore.getRecentPrices(symbol.toUpperCase(), 2000);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error(`[DataCtrl] getHistorical error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/data/fetch-and-store/:symbol
 * Fetches 5 years of daily OHLCV from Yahoo Finance (free, no key needed)
 * and upserts into daily_prices. Falls back to current-price-only if Yahoo fails.
 */
async function fetchAndStore(req, res) {
  const { symbol } = req.params;
  const sym = symbol.toUpperCase();

  // Yahoo Finance ticker for NSE: RELIANCE → RELIANCE.NS
  const yahooTicker = `${sym}.NS`;
  const to   = Math.floor(Date.now() / 1000);
  const from = to - 5 * 365 * 24 * 60 * 60;   // 5 years back

  try {
    logger.info(`[DataCtrl] Fetching historical data for ${sym} from Yahoo Finance`);

    const axios  = require('axios');
    const yahooRes = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}`,
      {
        params: { period1: from, period2: to, interval: '1d', events: 'history' },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        timeout: 20000,
      }
    );

    const result = yahooRes.data?.chart?.result?.[0];
    if (!result) throw new Error('No data returned from Yahoo Finance');

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const { open = [], high = [], low = [], close = [], volume = [] } = q;

    if (timestamps.length < 10) throw new Error(`Only ${timestamps.length} bars from Yahoo`);

    const rows = timestamps
      .map((ts, i) => ({
        symbol:   sym,
        date:     new Date(ts * 1000).toISOString().slice(0, 10),
        open:     parseFloat((open[i] || close[i] || 0).toFixed(2)),
        high:     parseFloat((high[i] || close[i] || 0).toFixed(2)),
        low:      parseFloat((low[i]  || close[i] || 0).toFixed(2)),
        close:    parseFloat((close[i] || 0).toFixed(2)),
        volume:   parseInt(volume[i] || 0, 10),
        exchange: 'NSE',
      }))
      .filter(r => r.close > 0 && r.date);

    let saved = 0;
    try {
      saved = await dataStore.saveDailyPrices(rows);
    } catch (dbErr) {
      logger.warn(`[DataCtrl] DB save partial: ${dbErr.message}`);
    }

    logger.info(`[DataCtrl] ✅ ${sym}: fetched ${rows.length} bars, saved ${saved}`);
    return res.json({
      success: true,
      fetched: rows.length,
      saved,
      symbol:  sym,
      source:  'YAHOO_FINANCE',
      from:    rows[0]?.date,
      to:      rows[rows.length - 1]?.date,
    });

  } catch (yahooErr) {
    logger.warn(`[DataCtrl] Yahoo Finance failed for ${sym}: ${yahooErr.message} — falling back to current price`);

    // Fallback: store just today's price so the symbol exists in DB
    try {
      const result = await marketDataService.getLivePrice(sym);
      const row = {
        symbol:   sym,
        date:     new Date().toISOString().slice(0, 10),
        open:     result.price, high: result.price,
        low:      result.price, close: result.price,
        volume:   0, exchange: 'NSE',
      };
      let saved = 0;
      try { saved = await dataStore.saveDailyPrices([row]); } catch (_) {}
      return res.json({
        success: true, fetched: 1, saved, symbol: sym,
        source: result.source, price: result.price,
        warning: `Yahoo Finance unavailable (${yahooErr.message}). Only current price stored — backtest needs 201+ bars.`,
      });
    } catch (err) {
      logger.error(`[DataCtrl] fetchAndStore total failure for ${sym}: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

/**
 * GET /api/data/prices/:symbol?limit=200
 * Reads stored price history from DB. Unchanged from original.
 */
async function getPrices(req, res) {
  try {
    const { symbol } = req.params;
    const rawLimit = parseInt(req.query.limit || '200', 10);
    const limit    = Math.min(Math.max(rawLimit, 1), 2000);
    const data     = await dataStore.getRecentPrices(symbol.toUpperCase(), limit);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error(`[DataCtrl] getPrices error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/nifty50
 * Returns prices for NIFTY 50 symbols using batch marketDataService call.
 * Response shape mirrors old NSE batch response.
 */
async function getNifty50(req, res) {
  try {
    const results = await marketDataService.getBatchPrices(NIFTY50_SYMBOLS);

    const data = results.map(r => ({
      symbol:    r.symbol,
      lastPrice: r.price,
      price:     r.price,
      source:    r.source,
      fetchedAt: r.timestamp,
      open: null, high: null, low: null,
      changePct: null, volume: null, marketCap: null,
    }));

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error(`[DataCtrl] getNifty50 error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/market-status
 * Returns synthetic market status based on IST time. No scraping needed.
 */
async function getMarketStatus(req, res) {
  try {
    const now       = new Date();
    const ist       = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const dayOfWeek = ist.getUTCDay();
    const timeVal   = ist.getUTCHours() * 100 + ist.getUTCMinutes();

    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    let status = 'Closed';
    if (isWeekday && timeVal >= 915 && timeVal < 1530) status = 'Open';
    else if (isWeekday && timeVal >= 900 && timeVal < 915) status = 'Pre-Open';

    const apiHealth  = await marketDataService.healthCheck();
    const cacheStats = marketDataService.getCacheStats();

    res.json({
      success: true,
      data: {
        marketStatus: status,
        isOpen:       status === 'Open',
        isPreOpen:    status === 'Pre-Open',
        istTime:      ist.toISOString(),
        note:         'Status computed from IST time. Real NSE status API removed.',
        dataSource:   { apiAvailable: apiHealth.ok, apiMessage: apiHealth.message, cacheStats },
      },
    });
  } catch (err) {
    logger.error(`[DataCtrl] getMarketStatus error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/health  (NEW)
 * Verifies Twelve Data API connectivity and returns cache diagnostics.
 */
// ── GET /api/data/candles/:symbol ── Upstox historical candles for the chart ──
async function getCandles(req, res) {
  try {
    const interval = ['1minute', '30minute', 'day', 'week', 'month'].includes(req.query.interval) ? req.query.interval : 'day';
    const days = Math.min(parseInt(req.query.days, 10) || 120, 400);
    const out = await marketDataService.getCandles(req.params.symbol, { interval, days });
    return res.json({ success: true, ...out });
  } catch (err) {
    return res.status(200).json({ success: false, candles: [], error: err.message });
  }
}

// Cache the health snapshot briefly — healthCheck() probes live providers
// (incl. a slow NSE fetch), so rapid status-bar polls should reuse a result.
let _healthCache = { at: 0, body: null };
const HEALTH_TTL = 8000;

async function getDataHealth(req, res) {
  try {
    if (_healthCache.body && Date.now() - _healthCache.at < HEALTH_TTL) {
      return res.status(200).json(_healthCache.body);
    }
    const health = await marketDataService.healthCheck();
    const stats  = marketDataService.getCacheStats();
    // Health *report*, not a gate. Always 200 so a degraded provider set doesn't
    // spam the console with 503s — the caller reads `api.overall`.
    const body = { success: true, api: health, cache: stats };
    _healthCache = { at: Date.now(), body };
    res.status(200).json(body);
  } catch (err) {
    res.status(200).json({ success: true, api: { overall: false, error: err.message }, cache: {} });
  }
}


/**
 * GET /api/data/stock/:symbol
 * Unified endpoint for the Trade UI.
 * Returns live price + aggregated signal + key indicators in one call.
 *
 * Response:
 *   { symbol, price, signal, rsi, trend, confidence, source, timestamp }
 *
 * Strategy:
 *   1. Fetch live price via marketDataService (API → simulation fallback)
 *   2. Fetch aggregated signal from aggregator using DB price history
 *   3. Merge both into a single response — never errors out (falls back to
 *      simulation price + HOLD signal if either source is unavailable)
 */
async function getStock(req, res) {
  const { symbol } = req.params;

  if (!symbol || !symbol.trim()) {
    return res.status(400).json({ success: false, error: 'Symbol is required' });
  }

  const sym = symbol.trim().toUpperCase();
  logger.info(`[DataCtrl] getStock: ${sym}`);

  try {
    // ── 1. Live price (always succeeds — simulation fallback built in) ────────
    const priceResult = await marketDataService.getLivePrice(sym);

    // ── 2. Signal from aggregator (requires DB price history) ─────────────────
    let signal     = 'HOLD';
    let confidence = null;
    let rsi        = null;
    let trend      = 'UNKNOWN';

    try {
      const dataStore  = require('../data/dataStore');
      const aggregator = require('../strategies/aggregator');

      const bars = await dataStore.getRecentPrices(sym, 250);

      if (bars && bars.length >= 20) {
        const closes = bars.map(b => b.close);
        const result = aggregator.aggregate(closes, { method: 'weighted', symbol: sym, useRegime: true });

        signal     = result.signal     || 'HOLD';
        confidence = result.confidence ?? null;
        rsi        = result.rsiValue   ?? null;

        // Normalise regime label → frontend-friendly trend string
        const regimeLabel = result.regime?.detected || '';
        if      (regimeLabel.includes('TREND') || regimeLabel === 'BULL' || regimeLabel === 'BEAR') {
          trend = 'TRENDING';
        } else if (regimeLabel.includes('MEAN') || regimeLabel.includes('RANG')) {
          trend = 'MEAN_REVERTING';
        } else {
          trend = regimeLabel || 'UNKNOWN';
        }
      } else {
        logger.warn(`[DataCtrl] getStock: insufficient bars for ${sym} (${bars?.length ?? 0}) — returning HOLD`);
      }
    } catch (sigErr) {
      // Signal generation is non-fatal — price data alone is still useful
      logger.warn(`[DataCtrl] getStock signal error for ${sym}: ${sigErr.message}`);
    }

    // ── 3. Merged response ────────────────────────────────────────────────────
    return res.json({
      success:    true,
      symbol:     sym,
      price:      priceResult.price,
      signal,
      confidence,
      rsi,
      trend,
      source:     priceResult.source,
      timestamp:  priceResult.timestamp,
    });

  } catch (err) {
    logger.error(`[DataCtrl] getStock error for ${sym}: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}


/**
 * GET /api/data/search?q=hbl&limit=10
 * Fast in-memory stock symbol + name search.
 */
function searchStocks(req, res) {
  const q     = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 30);
  if (!q) return res.json({ success: true, data: [], query: '' });

  // Curated top-200 first (best names/ranking), then fill from the full NSE
  // instrument master so ANY listed stock (Adani Power, Tata Steel, …) shows up.
  const seen = new Set();
  const merged = [];
  for (const r of stockMaster.search(q, limit)) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol); merged.push(r);
  }
  if (merged.length < limit) {
    try {
      const master = require('../data/instrumentMaster');
      for (const r of master.search(q, limit * 2)) {
        if (merged.length >= limit) break;
        if (seen.has(r.symbol)) continue;
        seen.add(r.symbol); merged.push(r);
      }
    } catch (_) { /* master unavailable — curated list only */ }
  }
  return res.json({ success: true, data: merged, query: q, total: merged.length });
}

module.exports = { getQuote, getStock, getHistorical, fetchAndStore, getPrices, getNifty50, getMarketStatus, getDataHealth,
  searchStocks, getCandles
};
