// src/strategies/trendFollowing.js
// ─────────────────────────────────────────────────────────────────────────────
// TIME-SERIES MOMENTUM / TREND FOLLOWING (long-only)
//
// Why this strategy exists in this codebase:
// The default AGGREGATED blend puts ~65% of its weight on mean-reversion
// (Z-score + RSI: "buy the dip") and ~35% on trend (MA crossover: "buy
// strength"). Those are logically opposed — in a sustained downtrend the
// mean-reversion majority keeps issuing BUYs into falling prices. This module
// implements a single, internally consistent thesis instead.
//
// Evidence base: time-series momentum is among the most robustly documented
// return anomalies — Moskowitz, Ooi & Pedersen (2012) and follow-up work find
// positive risk-adjusted returns across asset classes and across every decade
// from ~1880 to 2016. It is the core of the managed-futures/CTA industry.
// That is evidence of historical persistence, NOT a guarantee of future profit.
//
// Rules (long-only, daily bars):
//   REGIME  price > SMA(slow)                → only take longs in an uptrend
//   ENTRY   momentum(lookback) > 0 AND price > SMA(fast)
//   EXIT    price < SMA(fast) OR momentum(lookback) <= 0
//   SIZE    confidence scales with volatility-adjusted momentum (TSMOM style)
//
// Deliberate design choices that differ from the existing blend:
//   • No profit target. Trend-following earns from a few large winners; a fixed
//     4% TP truncates exactly the trades that pay for all the losers.
//   • Exits are trend-based, not a tight fixed stop — a 2% stop is inside daily
//     noise for most NSE equities and guarantees whipsaw.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const P = {
  FAST_MA:  parseInt(process.env.TF_FAST_MA  || '50', 10),
  SLOW_MA:  parseInt(process.env.TF_SLOW_MA  || '200', 10),
  LOOKBACK: parseInt(process.env.TF_LOOKBACK || '90', 10),   // momentum window
  VOL_WIN:  parseInt(process.env.TF_VOL_WIN  || '20', 10),
};

const sma = (a, n) => (a.length < n ? null : a.slice(-n).reduce((x, y) => x + y, 0) / n);

// Annualised realised vol from daily closes.
function realisedVol(closes, n) {
  if (closes.length < n + 1) return null;
  const w = closes.slice(-(n + 1));
  const rets = [];
  for (let i = 1; i < w.length; i++) if (w[i - 1] > 0) rets.push((w[i] - w[i - 1]) / w[i - 1]);
  if (rets.length < 2) return null;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

/**
 * @param {number[]} prices ascending closes
 * @returns {{signal, confidence, reason, maFast, maSlow, momentum, currentPrice}}
 */
function generateSignal(prices) {
  const need = Math.max(P.SLOW_MA, P.LOOKBACK) + 1;
  if (!Array.isArray(prices) || prices.length < need) {
    return { signal: 'HOLD', confidence: 0, currentPrice: prices?.at(-1) ?? null,
      maFast: null, maSlow: null, momentum: null,
      reason: `Insufficient data (need ${need}, got ${prices?.length ?? 0})` };
  }

  const price   = prices[prices.length - 1];
  const maFast  = sma(prices, P.FAST_MA);
  const maSlow  = sma(prices, P.SLOW_MA);
  const past    = prices[prices.length - 1 - P.LOOKBACK];
  const momentum = past > 0 ? (price - past) / past : 0;      // lookback return
  const vol      = realisedVol(prices, P.VOL_WIN) || 0.25;

  const inUptrend  = maSlow != null && price > maSlow;
  const aboveFast  = maFast != null && price > maFast;
  const momUp      = momentum > 0;

  // Volatility-adjusted momentum → confidence (TSMOM sizing intuition:
  // same signal in a calmer name deserves more weight).
  const conf = Math.max(0, Math.min(1, Math.abs(momentum) / (vol || 0.25)));

  let signal = 'HOLD', reason;
  if (inUptrend && aboveFast && momUp) {
    signal = 'BUY';
    reason = `Uptrend: price ${price.toFixed(2)} > SMA${P.FAST_MA} & SMA${P.SLOW_MA}, ${P.LOOKBACK}d momentum ${(momentum * 100).toFixed(1)}%`;
  } else if (!aboveFast || !momUp) {
    // Exit condition — trend broken. (Long-only: SELL means "close longs".)
    signal = 'SELL';
    reason = !aboveFast
      ? `Trend break: price ${price.toFixed(2)} < SMA${P.FAST_MA}`
      : `Momentum turned negative (${(momentum * 100).toFixed(1)}%)`;
  } else {
    reason = 'No trend confirmation';
  }

  return {
    signal,
    confidence: parseFloat(conf.toFixed(4)),
    currentPrice: price,
    maFast: maFast != null ? parseFloat(maFast.toFixed(4)) : null,
    maSlow: maSlow != null ? parseFloat(maSlow.toFixed(4)) : null,
    momentum: parseFloat((momentum * 100).toFixed(4)),
    volatility: parseFloat(vol.toFixed(4)),
    reason,
  };
}

function describe() {
  return {
    name: 'TREND_FOLLOWING',
    type: 'time-series momentum (long-only)',
    params: P,
    basis: 'Moskowitz/Ooi/Pedersen time-series momentum; CTA trend-following',
    note: 'Historical persistence ≠ guaranteed future profit.',
  };
}

module.exports = { generateSignal, describe, PARAMS: P };
