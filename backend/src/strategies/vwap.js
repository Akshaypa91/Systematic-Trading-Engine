// src/strategies/vwap.js
// VWAP — Volume Weighted Average Price
// Institutional benchmark. Price above VWAP = bullish bias.
'use strict';

/**
 * Calculate VWAP from OHLCV bars.
 * bars: [{ high, low, close, volume }]
 */
function calcVWAP(bars) {
  if (!bars || bars.length === 0) return null;
  let cumTPV = 0;  // cumulative (typical price × volume)
  let cumVol = 0;

  for (const b of bars) {
    const tp  = (parseFloat(b.high) + parseFloat(b.low) + parseFloat(b.close)) / 3;
    const vol = parseFloat(b.volume) || 0;
    cumTPV += tp * vol;
    cumVol += vol;
  }
  return cumVol > 0 ? cumTPV / cumVol : null;
}

/**
 * VWAP standard deviation bands.
 * Returns { vwap, upper1, lower1, upper2, lower2 }
 */
function calcVWAPBands(bars, stdDevMultiplier = 1.5) {
  if (!bars || bars.length < 2) return null;

  let cumTPV  = 0;
  let cumVol  = 0;
  let cumTP2V = 0;

  for (const b of bars) {
    const tp  = (parseFloat(b.high) + parseFloat(b.low) + parseFloat(b.close)) / 3;
    const vol = parseFloat(b.volume) || 0;
    cumTPV  += tp * vol;
    cumVol  += vol;
    cumTP2V += tp * tp * vol;
  }

  if (cumVol === 0) return null;
  const vwap    = cumTPV / cumVol;
  const variance = (cumTP2V / cumVol) - (vwap * vwap);
  const stdDev  = Math.sqrt(Math.max(variance, 0));

  return {
    vwap:   parseFloat(vwap.toFixed(2)),
    upper1: parseFloat((vwap + stdDev).toFixed(2)),
    lower1: parseFloat((vwap - stdDev).toFixed(2)),
    upper2: parseFloat((vwap + stdDevMultiplier * stdDev).toFixed(2)),
    lower2: parseFloat((vwap - stdDevMultiplier * stdDev).toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(4)),
  };
}

/**
 * Generate VWAP signal from bars.
 * @param {Array} bars OHLCV bars (ideally intraday, works on daily too)
 * @param {number} currentPrice Latest price
 */
function computeVWAP(bars, currentPrice) {
  if (!bars || bars.length < 5 || !currentPrice) {
    return { signal: 'HOLD', confidence: 0, vwap: null };
  }

  const bands = calcVWAPBands(bars);
  if (!bands) return { signal: 'HOLD', confidence: 0, vwap: null };

  const { vwap, upper1, lower1, upper2, lower2 } = bands;
  const price  = parseFloat(currentPrice);
  const pctDev = (price - vwap) / vwap;  // % distance from VWAP

  let signal     = 'HOLD';
  let confidence = 0;

  // Strong buy: price near or below lower VWAP band
  if (price <= lower2) {
    signal     = 'BUY';
    confidence = 0.75;
  } else if (price <= lower1) {
    signal     = 'BUY';
    confidence = 0.55;
  }
  // Strong sell: price near or above upper VWAP band
  else if (price >= upper2) {
    signal     = 'SELL';
    confidence = 0.75;
  } else if (price >= upper1) {
    signal     = 'SELL';
    confidence = 0.55;
  }
  // Near VWAP — mild bias
  else if (pctDev > 0) {
    signal     = 'HOLD';  // above VWAP but within bands
    confidence = 0.20;
  } else {
    signal     = 'HOLD';  // below VWAP but within bands
    confidence = 0.20;
  }

  confidence = Math.min(confidence, 0.95);

  return {
    signal,
    confidence,
    vwap:         bands.vwap,
    upper1:       bands.upper1,
    lower1:       bands.lower1,
    upper2:       bands.upper2,
    lower2:       bands.lower2,
    pctFromVWAP:  parseFloat((pctDev * 100).toFixed(2)),
    aboveVWAP:    price > vwap,
  };
}

module.exports = { calcVWAP, calcVWAPBands, computeVWAP };
