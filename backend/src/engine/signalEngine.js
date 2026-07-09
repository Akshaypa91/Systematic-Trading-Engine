// src/engine/signalEngine.js
// ─────────────────────────────────────────────────────────────────────────────
//
// REAL-TIME SIGNAL ENGINE
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates BUY / SELL / HOLD signals from three indicators:
//   • RSI(14)           — momentum / mean-reversion
//   • SMA20 vs SMA50    — trend direction
//   • Bollinger Bands   — volatility / price extremes
//
// SCORING (integer vote system)
// ──────────────────────────────
//   Each indicator casts a vote: +1 (BUY), -1 (SELL), 0 (HOLD/neutral)
//   Score range: [-3, +3]
//
//   score ≥ +2 → BUY
//   score ≤ -2 → SELL
//   else       → HOLD
//
// CONFIDENCE
// ──────────
//   confidence = |score| / 3    (0.33 for 1 vote, 0.67 for 2, 1.0 for 3)
//   Capped at 0.95 — never fully certain
//
// OUTPUT FORMAT (per symbol)
// ──────────────────────────
//   {
//     symbol, signal, confidence, currentPrice, score,
//     rsi, sma20, sma50, bbUpper, bbLower, bbMiddle,
//     components: { rsi, ma, bb },
//     timestamp
//   }
//
// ARCHITECTURE
// ─────────────
//   calculateRSI(prices, period)     → number | null
//   calculateMA(prices, period)      → number | null
//   calculateBB(prices, period, std) → { upper, middle, lower } | null
//   combineSignals(indicators)       → { signal, score, confidence, components }
//   generateSignal(symbol, prices)   → full output object
//
// CACHING
// ────────
//   In-memory cache per symbol. Re-computes only when
//   a new price arrives or MIN_RECOMPUTE_MS has elapsed.
//   Call getSignal(symbol) for fast cache read.
//   Call computeSignal(symbol, prices) to force-recompute.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────

const RSI_PERIOD         = parseInt(process.env.SIGNAL_RSI_PERIOD    || '14', 10);
const SMA_FAST           = parseInt(process.env.SIGNAL_SMA_FAST      || '20', 10);
const SMA_SLOW           = parseInt(process.env.SIGNAL_SMA_SLOW      || '50', 10);
const BB_PERIOD          = parseInt(process.env.SIGNAL_BB_PERIOD     || '20', 10);
const BB_STDDEV          = parseFloat(process.env.SIGNAL_BB_STDDEV   || '2');
const RSI_OVERSOLD       = parseFloat(process.env.SIGNAL_RSI_OS      || '30');
const RSI_OVERBOUGHT     = parseFloat(process.env.SIGNAL_RSI_OB      || '70');
const BUY_THRESHOLD      = parseInt(process.env.SIGNAL_BUY_THRESH    || '2', 10);   // score >= this → BUY
const SELL_THRESHOLD     = parseInt(process.env.SIGNAL_SELL_THRESH   || '-2', 10);  // score <= this → SELL
const MIN_RECOMPUTE_MS   = parseInt(process.env.SIGNAL_MIN_RECOMPUTE || '3000', 10);

// ── Signal cache ──────────────────────────────────────────────────────────────

// symbol → { signal: object, computedAt: number, lastPrice: number }
const _cache = new Map();

// ── Step 1: Indicator functions ───────────────────────────────────────────────

/**
 * Wilder RSI.
 *
 * Algorithm:
 *   Δᵢ = priceᵢ − priceᵢ₋₁
 *   Seed: AvgGain = mean(positive Δ over first `period` changes)
 *         AvgLoss = mean(|negative Δ| over first `period` changes)
 *   Smooth (Wilder): AvgGainₜ = (AvgGainₜ₋₁ × (n−1) + gainₜ) / n
 *   RS  = AvgGain / AvgLoss
 *   RSI = 100 − 100 / (1 + RS)
 *
 * @param {number[]} prices  Close prices, ascending. Needs ≥ period+1 bars.
 * @param {number}   period  Lookback period (default 14).
 * @returns {number|null}    RSI value [0–100], or null if insufficient data.
 */
function calculateRSI(prices, period = RSI_PERIOD) {
  if (!Array.isArray(prices) || prices.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (!isFinite(d)) return null;
    changes.push(d);
  }

  // Seed with simple mean over first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else                 avgLoss += -changes[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0))  / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Simple Moving Average over the last `period` values.
 *
 * Algorithm: SMAₙ = (1/n) Σᵢ₌₀ⁿ⁻¹ priceₜ₋ᵢ
 *
 * @param {number[]} prices  Close prices, ascending.
 * @param {number}   period  Lookback window.
 * @returns {number|null}    SMA value, or null if insufficient data.
 */
function calculateMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period || period < 1) return null;
  const slice = prices.slice(-period);
  if (slice.some(v => !isFinite(v))) return null;
  return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * Bollinger Bands.
 *
 * Algorithm:
 *   Middle = SMA(prices, period)
 *   σ      = population std-dev over same window
 *   Upper  = Middle + stdDevMult × σ
 *   Lower  = Middle − stdDevMult × σ
 *
 * @param {number[]} prices      Close prices, ascending.
 * @param {number}   period      Lookback window (default 20).
 * @param {number}   stdDevMult  Band width multiplier (default 2).
 * @returns {{ upper: number, middle: number, lower: number, sd: number }|null}
 */
function calculateBB(prices, period = BB_PERIOD, stdDevMult = BB_STDDEV) {
  if (!Array.isArray(prices) || prices.length < period) return null;
  const slice = prices.slice(-period);
  if (slice.some(v => !isFinite(v))) return null;

  const mean     = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const sd       = Math.sqrt(variance);

  return {
    upper:  parseFloat((mean + stdDevMult * sd).toFixed(4)),
    middle: parseFloat(mean.toFixed(4)),
    lower:  parseFloat((mean - stdDevMult * sd).toFixed(4)),
    sd:     parseFloat(sd.toFixed(4)),
  };
}

// ── Step 2: Signal combiner ───────────────────────────────────────────────────

/**
 * Combine individual indicator signals into a single weighted score.
 *
 * VOTE RULES:
 *   RSI:
 *     rsi < RSI_OVERSOLD  → +1 BUY   (component: 'oversold')
 *     rsi > RSI_OVERBOUGHT → -1 SELL  (component: 'overbought')
 *     else                → 0 HOLD   (component: 'neutral')
 *
 *   MA (SMA20 vs SMA50):
 *     sma20 > sma50 → +1 BUY   (component: 'bullish')
 *     sma20 < sma50 → -1 SELL  (component: 'bearish')
 *     equal          → 0 HOLD  (component: 'flat')
 *
 *   BB:
 *     price < bbLower → +1 BUY   (component: 'lower_band')
 *     price > bbUpper → -1 SELL  (component: 'upper_band')
 *     else             → 0 HOLD  (component: 'inside_bands')
 *
 * DECISION:
 *   score ≥ BUY_THRESHOLD  (+2) → 'BUY'
 *   score ≤ SELL_THRESHOLD (-2) → 'SELL'
 *   else                        → 'HOLD'
 *
 * @param {{ rsi, sma20, sma50, bb, currentPrice }} indicators
 * @returns {{ signal, score, confidence, components }}
 */
function combineSignals({ rsi, sma20, sma50, bb, currentPrice }) {
  let score = 0;
  const components = {};

  // ── RSI vote ──────────────────────────────────────────────────────────────
  if (rsi !== null && isFinite(rsi)) {
    if (rsi < RSI_OVERSOLD) {
      score += 1;
      components.rsi = 'oversold';
    } else if (rsi > RSI_OVERBOUGHT) {
      score -= 1;
      components.rsi = 'overbought';
    } else {
      components.rsi = 'neutral';
    }
  } else {
    components.rsi = 'unavailable';
  }

  // ── MA vote ───────────────────────────────────────────────────────────────
  if (sma20 !== null && sma50 !== null && isFinite(sma20) && isFinite(sma50)) {
    if (sma20 > sma50) {
      score += 1;
      components.ma = 'bullish';
    } else if (sma20 < sma50) {
      score -= 1;
      components.ma = 'bearish';
    } else {
      components.ma = 'flat';
    }
  } else {
    components.ma = 'unavailable';
  }

  // ── Bollinger Bands vote ──────────────────────────────────────────────────
  if (bb !== null && isFinite(currentPrice)) {
    if (currentPrice < bb.lower) {
      score += 1;
      components.bb = 'lower_band';
    } else if (currentPrice > bb.upper) {
      score -= 1;
      components.bb = 'upper_band';
    } else {
      components.bb = 'inside_bands';
    }
  } else {
    components.bb = 'unavailable';
  }

  // ── Final decision ────────────────────────────────────────────────────────
  let signal;
  if      (score >= BUY_THRESHOLD)  signal = 'BUY';
  else if (score <= SELL_THRESHOLD) signal = 'SELL';
  else                               signal = 'HOLD';

  // Confidence: fraction of maximum possible score, capped at 0.95
  const maxScore  = 3; // three indicators
  const confidence = Math.min(Math.abs(score) / maxScore, 0.95);

  return {
    signal,
    score,
    confidence: parseFloat(confidence.toFixed(4)),
    components,
  };
}

// ── Step 3: Full signal generation for one symbol ─────────────────────────────

/**
 * Compute a complete signal object for one symbol.
 *
 * @param {string}   symbol   Ticker symbol (e.g. 'RELIANCE')
 * @param {number[]} prices   Close prices, ascending, last 50–250 bars
 * @returns {SignalResult}    Full signal object (see OUTPUT FORMAT at top)
 */
function computeSignal(symbol, prices) {
  if (!Array.isArray(prices) || prices.length < SMA_SLOW + 1) {
    return {
      symbol,
      signal:      'HOLD',
      confidence:  0,
      score:       0,
      currentPrice: prices?.at(-1) ?? null,
      rsi:         null,
      sma20:       null,
      sma50:       null,
      bbUpper:     null,
      bbMiddle:    null,
      bbLower:     null,
      components:  { rsi: 'unavailable', ma: 'unavailable', bb: 'unavailable' },
      error:       `Insufficient data — need ≥${SMA_SLOW + 1} bars, got ${prices?.length ?? 0}`,
      timestamp:   new Date().toISOString(),
    };
  }

  const currentPrice = prices[prices.length - 1];

  // ── Compute indicators ────────────────────────────────────────────────────
  const rsi  = calculateRSI(prices, RSI_PERIOD);
  const sma20 = calculateMA(prices, SMA_FAST);
  const sma50 = calculateMA(prices, SMA_SLOW);
  const bb    = calculateBB(prices, BB_PERIOD, BB_STDDEV);

  // ── Combine into signal ───────────────────────────────────────────────────
  const { signal, score, confidence, components } = combineSignals({
    rsi, sma20, sma50, bb, currentPrice,
  });

  const result = {
    symbol,
    signal,
    confidence,
    score,
    currentPrice: parseFloat(currentPrice.toFixed(2)),
    rsi:          rsi    !== null ? parseFloat(rsi.toFixed(2))    : null,
    sma20:        sma20  !== null ? parseFloat(sma20.toFixed(2))  : null,
    sma50:        sma50  !== null ? parseFloat(sma50.toFixed(2))  : null,
    bbUpper:      bb     !== null ? parseFloat(bb.upper.toFixed(2)) : null,
    bbMiddle:     bb     !== null ? parseFloat(bb.middle.toFixed(2)) : null,
    bbLower:      bb     !== null ? parseFloat(bb.lower.toFixed(2)) : null,
    components,
    timestamp:    new Date().toISOString(),
  };

  // ── Update cache ──────────────────────────────────────────────────────────
  _cache.set(symbol.toUpperCase(), {
    signal:     result,
    computedAt: Date.now(),
    lastPrice:  currentPrice,
  });

  return result;
}

// ── Step 4: Cache-aware getter ────────────────────────────────────────────────

/**
 * Get latest signal for a symbol.
 * Returns cached result if price unchanged and within MIN_RECOMPUTE_MS.
 * Falls back to recomputing when prices array is supplied and cache is stale.
 *
 * @param {string}   symbol
 * @param {number[]} [prices]  Provide to allow recompute when cache stale.
 * @returns {SignalResult|null}
 */
function getSignal(symbol, prices = null) {
  const key    = symbol.toUpperCase();
  const cached = _cache.get(key);

  if (cached) {
    const age           = Date.now() - cached.computedAt;
    const priceChanged  = prices !== null &&
      prices.at(-1) !== cached.lastPrice;

    // Serve cache if fresh AND price hasn't changed
    if (!priceChanged && age < MIN_RECOMPUTE_MS) {
      return cached.signal;
    }
  }

  // Recompute if prices provided, otherwise return stale cache or null
  if (prices !== null) {
    return computeSignal(symbol, prices);
  }

  return cached ? cached.signal : null;
}

/**
 * Get all cached signals (for all symbols seen so far).
 * @returns {SignalResult[]}
 */
function getAllCachedSignals() {
  return [..._cache.values()].map(v => v.signal);
}

/**
 * Invalidate cache for a specific symbol (or all symbols).
 * @param {string} [symbol]  Omit to clear all.
 */
function clearCache(symbol = null) {
  if (symbol) _cache.delete(symbol.toUpperCase());
  else        _cache.clear();
}

/**
 * Batch compute signals for multiple symbols.
 * Respects cache per symbol.
 *
 * @param {Array<{ symbol: string, prices: number[] }>} batch
 * @returns {SignalResult[]}
 */
function computeSignalBatch(batch) {
  if (!Array.isArray(batch)) return [];
  return batch.map(({ symbol, prices }) => computeSignal(symbol, prices));
}

// ── Module config exposure ────────────────────────────────────────────────────

function getConfig() {
  return {
    RSI_PERIOD,
    SMA_FAST,
    SMA_SLOW,
    BB_PERIOD,
    BB_STDDEV,
    RSI_OVERSOLD,
    RSI_OVERBOUGHT,
    BUY_THRESHOLD,
    SELL_THRESHOLD,
    MIN_RECOMPUTE_MS,
  };
}

// ── Step 1: Live price integration ────────────────────────────────────────────
//
// generateLiveSignal(symbol, priceHistory)
// ────────────────────────────────────────
// Fetches real-time price via marketDataService (Twelve Data API → sim fallback).
// Appends it to the rolling price history, then runs computeSignal.
//
// The caller (simulationEngine tick loop) owns the history array.
// We mutate it in-place (rolling 500-bar window) for efficiency.
//
// Returns: { ...signalResult, source: "LIVE" | "SIM" }
//
// Price cache: marketDataService already caches 8s. We also check our own
// signal cache (MIN_RECOMPUTE_MS) to avoid recomputing on every 3s tick
// when price hasn't moved.

let _marketDataSvc = null;

function _getMarketSvc() {
  if (!_marketDataSvc) {
    try {
      _marketDataSvc = require('../services/marketDataService');
    } catch (_) {
      // marketDataService unavailable (e.g. test env) — use null
    }
  }
  return _marketDataSvc;
}

/**
 * Fetch live price, append to history, compute signal.
 *
 * @param {string}   symbol       NSE ticker
 * @param {number[]} priceHistory Rolling price array (mutated in-place)
 * @param {number}   [maxLen=500] Max history length to keep
 * @returns {Promise<SignalResult & { source: 'LIVE'|'SIM' }>}
 */
async function generateLiveSignal(symbol, priceHistory, maxLen = 500) {
  const svc = _getMarketSvc();

  let livePrice = null;
  let source    = 'SIM';

  if (svc) {
    try {
      const result = await svc.getLivePrice(symbol);
      livePrice = result.price;
      // getLivePrice returns real-provider sources as LIVE_NSE / LIVE_UPSTOX /
      // LIVE_TWELVE / LIVE_FINNHUB, and 'SIM' for the fallback. Anything that
      // isn't SIM is a real live price.
      source    = (result.source && result.source !== 'SIM') ? 'LIVE' : 'SIM';
    } catch (_) {
      // Fallback: use last known price from history
    }
  }

  // If we got a real price, append it to history
  if (livePrice !== null && isFinite(livePrice) && livePrice > 0) {
    priceHistory.push(livePrice);
    if (priceHistory.length > maxLen) priceHistory.shift();
  }

  // Check signal cache — skip recompute if price unchanged
  const sym    = symbol.toUpperCase();
  const cached = _cache.get(sym);
  const curPrice = priceHistory[priceHistory.length - 1];

  if (cached && cached.lastPrice === curPrice &&
      Date.now() - cached.computedAt < MIN_RECOMPUTE_MS) {
    return { ...cached.signal, source };
  }

  const sig = computeSignal(symbol, priceHistory);
  return { ...sig, source };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Indicator functions
  calculateRSI,
  calculateMA,
  calculateBB,

  // Signal logic
  combineSignals,
  computeSignal,
  computeSignalBatch,
  generateLiveSignal,

  // Cache API
  getSignal,
  getAllCachedSignals,
  clearCache,

  // Introspection
  getConfig,
};
