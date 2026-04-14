// src/controllers/dataController.js
// ─────────────────────────────────────────────────────────────────────────────
// Data Controller — all market data now flows through marketDataService.
// NSE scraping (403-prone) replaced with Twelve Data API + simulation fallback.
// Existing API routes (/api/data/*) and response shapes are UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const marketDataService = require('../services/marketDataService');
const dataStore         = require('../data/dataStore');
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
 * Fetches current price via marketDataService and stores as a synthetic row.
 */
async function fetchAndStore(req, res) {
  try {
    const { symbol } = req.params;
    const sym = symbol.toUpperCase();

    const result = await marketDataService.getLivePrice(sym);

    const row = {
      symbol:   sym,
      date:     new Date().toISOString().slice(0, 10),
      open:     result.price,
      high:     result.price,
      low:      result.price,
      close:    result.price,
      vwap:     result.price,
      volume:   0,
      exchange: 'NSE',
    };

    let saved = 0;
    try {
      saved = await dataStore.saveDailyPrices([row]);
    } catch (dbErr) {
      logger.warn(`[DataCtrl] fetchAndStore DB save skipped (${dbErr.message})`);
    }

    res.json({
      success: true,
      fetched: 1,
      saved,
      symbol:  sym,
      source:  result.source,
      price:   result.price,
      note:    'Historical OHLCV not available on free Twelve Data tier — current price stored.',
    });
  } catch (err) {
    logger.error(`[DataCtrl] fetchAndStore error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
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
async function getDataHealth(req, res) {
  try {
    const health = await marketDataService.healthCheck();
    const stats  = marketDataService.getCacheStats();
    res.status(health.ok ? 200 : 503).json({ success: health.ok, api: health, cache: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

module.exports = { getQuote, getStock, getHistorical, fetchAndStore, getPrices, getNifty50, getMarketStatus, getDataHealth };