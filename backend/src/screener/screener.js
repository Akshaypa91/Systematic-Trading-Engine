// src/screener/screener.js
// ─────────────────────────────────────────────────────────────────────────────
// Stock Screener
//
// RANKING DIMENSIONS
// ──────────────────
// 1. MOMENTUM SCORE
//    rate-of-change over N days:  ROC = (P_t - P_{t-N}) / P_{t-N}
//    Normalised to [0,1] across all stocks in the universe.
//    High score = strong recent uptrend.
//
// 2. VOLATILITY SCORE
//    annualised std-dev of daily log returns:  σ × √252
//    Normalised — inverted so LOW volatility → HIGH score.
//    Useful for identifying stable instruments.
//
// 3. MEAN REVERSION SCORE
//    Absolute Z-score of latest price relative to 20-day rolling mean.
//    |Z| > 2 → extreme deviation → potential reversion opportunity.
//    Normalised to [0,1].  High score = strong MR opportunity.
//
// COMPOSITE RANK
//    composite = w1 × momentum + w2 × (1 - volatility) + w3 × mrScore
//    Default weights: [0.4, 0.3, 0.3]
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const dataStore = require('../data/dataStore');
const mu        = require('../utils/mathUtils');
const C         = require('../config/constants');
const logger    = require('../config/logger');

const SC = C.SCREENER;

// Limit concurrent DB queries — prevents 50 simultaneous connections for NIFTY50
async function _withConcurrency(tasks, limit = 8) {
  const results = [];
  let i = 0;
  async function run() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, run);
  await Promise.all(workers);
  return results;
}



/**
 * Screen a universe of symbols and return ranked results.
 *
 * @param {string[]}  symbols        - List of NSE symbols to screen
 * @param {Object}    opts
 * @param {number}    opts.topN       - Return only top N results
 * @param {Object}    opts.weights    - { momentum, volatility, meanReversion } (must sum to 1)
 * @param {string}    opts.filter     - 'BUY_CANDIDATES' | 'SELL_CANDIDATES' | 'ALL'
 * @returns {Promise<Array<Object>>}
 */
async function runScreener(symbols, opts = {}) {
  const {
    topN    = 20,
    weights = { momentum: 0.40, volatility: 0.30, meanReversion: 0.30 },
    filter  = 'ALL',
  } = opts;

  logger.info(`[Screener] Scanning ${symbols.length} symbols...`);
  const start = Date.now();

  // ── Fetch data for all symbols in parallel ────────────────────────────
  const minBars = Math.max(SC.MOMENTUM_LOOKBACK_DAYS, SC.VOLATILITY_LOOKBACK_DAYS, SC.MR_LOOKBACK_DAYS) + 5;

  const tasks   = symbols.map(symbol => () => scoreSymbol(symbol, minBars).then(r => ({ status: 'fulfilled', value: r })).catch(e => ({ status: 'rejected', reason: e })));
  const results = await _withConcurrency(tasks, 8);

  const scored = results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  if (scored.length === 0) {
    logger.warn('[Screener] No symbols could be scored');
    return [];
  }

  // ── Normalise each dimension across the universe ──────────────────────
  const normalise = (arr, key) => {
    const vals = arr.map(s => s[key]);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    return arr.map(s => ({ ...s, [`${key}Norm`]: mu.normalise(s[key], minV, maxV) }));
  };

  let ranked = normalise(scored, 'momentum');
  ranked = normalise(ranked, 'volatility');
  ranked = normalise(ranked, 'mrScore');

  // ── Composite score ───────────────────────────────────────────────────
  ranked = ranked.map(s => ({
    ...s,
    // Invert volatility: low vol → high score
    compositeScore: parseFloat((
      weights.momentum      * s.momentumNorm +
      weights.volatility    * (1 - s.volatilityNorm) +
      weights.meanReversion * s.mrScoreNorm
    ).toFixed(6)),
  }));

  // ── Sort descending by composite score ───────────────────────────────
  ranked.sort((a, b) => b.compositeScore - a.compositeScore);

  // ── Assign ranks + display aliases the frontend expects ────────────────
  // (frontend reads momentumScore/volatilityScore/mrScore as normalised 0–1)
  ranked = ranked.map((s, i) => ({
    rank: i + 1,
    ...s,
    score:           s.compositeScore,
    momentumScore:   s.momentumNorm,
    volatilityScore: s.volatilityNorm,
    mrScore:         s.mrScoreNorm,     // normalised for consistent display
  }));

  // ── Optional filter ───────────────────────────────────────────────────
  let filtered = ranked;
  if (filter === 'BUY_CANDIDATES')  filtered = ranked.filter(s => s.zScore < -1.5 || s.rsi < 35);
  if (filter === 'SELL_CANDIDATES') filtered = ranked.filter(s => s.zScore >  1.5 || s.rsi > 65);

  const elapsed = Date.now() - start;
  logger.info(`[Screener] Completed ${symbols.length} symbols in ${elapsed}ms. Top: ${ranked[0]?.symbol}`);

  return filtered.slice(0, topN);
}

/**
 * Compute raw scores for a single symbol.
 * Returns null if insufficient data.
 */
async function scoreSymbol(symbol, minBars) {
  try {
    let bars = await dataStore.getRecentPrices(symbol, minBars + 50);
    // Fallback: DB has no history for most NSE symbols (sim keeps prices in
    // memory; NSE store unused). Pull real daily candles from Upstox instead.
    if (!bars || bars.length < minBars) {
      try {
        const md = require('../services/marketDataService');
        const { candles } = await md.getCandles(symbol, { interval: 'day', days: minBars + 90 });
        if (Array.isArray(candles) && candles.length) bars = candles.map(c => ({ close: c.c }));
      } catch (_) { /* keep whatever the DB gave */ }
    }
    if (!bars || bars.length < minBars) {
      logger.debug(`[Screener] Skipping ${symbol}: only ${bars?.length ?? 0} bars (need ${minBars})`);
      return null;
    }

    const closes = bars.map(b => b.close);
    const latest = closes[closes.length - 1];

    // ── Momentum: N-day Rate of Change ──────────────────────────────────
    const prevPrice = closes[closes.length - 1 - SC.MOMENTUM_LOOKBACK_DAYS];
    const momentum  = prevPrice > 0 ? (latest - prevPrice) / prevPrice : 0;

    // ── Volatility: annualised σ of log returns ──────────────────────────
    const returns    = mu.logReturns(closes.slice(-SC.VOLATILITY_LOOKBACK_DAYS - 1));
    const annualVol  = returns.length > 1
      ? mu.stdDev(returns) * Math.sqrt(C.BACKTEST.TRADING_DAYS_PER_YEAR)
      : 0;

    // ── Mean Reversion: |Z-score| ─────────────────────────────────────────
    const mrWindow  = closes.slice(-SC.MR_LOOKBACK_DAYS);
    const mrMean    = mu.mean(mrWindow);
    const mrStd     = mu.stdDev(mrWindow);
    const zScore    = mrStd > 0 ? (latest - mrMean) / mrStd : 0;
    const mrScore   = Math.abs(zScore);   // larger deviation → higher opportunity

    // ── RSI ───────────────────────────────────────────────────────────────
    const rsiVal    = mu.rsi(closes, 14);

    return {
      symbol,
      lastPrice:  parseFloat(latest.toFixed(4)),
      momentum:   parseFloat(momentum.toFixed(6)),
      volatility: parseFloat(annualVol.toFixed(6)),
      mrScore:    parseFloat(mrScore.toFixed(6)),
      zScore:     parseFloat(zScore.toFixed(4)),
      rsi:        rsiVal ? parseFloat(rsiVal.toFixed(2)) : null,
    };
  } catch (err) {
    logger.warn(`[Screener] ${symbol} score failed: ${err.message}`);
    return null;
  }
}

module.exports = { runScreener, scoreSymbol };
