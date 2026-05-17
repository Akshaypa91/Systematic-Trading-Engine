// src/strategies/macd.js
// MACD (Moving Average Convergence Divergence)
// Signal: histogram crossover above/below zero
'use strict';

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k    = 2 / (period + 1);
  let   ema  = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMASeries(prices, period) {
  if (prices.length < period) return [];
  const k      = 2 / (period + 1);
  const result = [];
  let   ema    = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function computeMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod + signalPeriod) {
    return { signal: 'HOLD', confidence: 0, macdLine: null, signalLine: null, histogram: null };
  }

  const emaFast    = calcEMASeries(prices, fastPeriod);
  const emaSlow    = calcEMASeries(prices, slowPeriod);
  const minLen     = Math.min(emaFast.length, emaSlow.length);
  const macdSeries = emaFast.slice(emaFast.length - minLen)
    .map((v, i) => v - emaSlow[emaSlow.length - minLen + i]);

  if (macdSeries.length < signalPeriod) {
    return { signal: 'HOLD', confidence: 0, macdLine: null, signalLine: null, histogram: null };
  }

  const signalLine  = calcEMA(macdSeries, signalPeriod);
  const macdLine    = macdSeries[macdSeries.length - 1];
  const prevMACD    = macdSeries[macdSeries.length - 2];
  const histogram   = parseFloat((macdLine - signalLine).toFixed(4));
  const prevHist    = parseFloat((prevMACD  - signalLine).toFixed(4));

  let   signal     = 'HOLD';
  let   confidence = 0;

  // Bullish crossover — histogram crosses above zero
  if (prevHist <= 0 && histogram > 0) {
    signal     = 'BUY';
    confidence = Math.min(Math.abs(histogram) / Math.abs(macdLine + 0.0001), 1);
  }
  // Bearish crossover — histogram crosses below zero
  else if (prevHist >= 0 && histogram < 0) {
    signal     = 'SELL';
    confidence = Math.min(Math.abs(histogram) / Math.abs(macdLine + 0.0001), 1);
  }
  // Strong momentum
  else if (histogram > 0 && macdLine > 0) {
    signal     = 'BUY';
    confidence = 0.35;
  } else if (histogram < 0 && macdLine < 0) {
    signal     = 'SELL';
    confidence = 0.35;
  }

  confidence = Math.min(Math.max(parseFloat(confidence.toFixed(4)), 0), 0.95);

  return {
    signal,
    confidence,
    macdLine:   parseFloat(macdLine.toFixed(4)),
    signalLine: parseFloat(signalLine.toFixed(4)),
    histogram,
    bullish:    histogram > 0,
  };
}

module.exports = { computeMACD, calcEMA, calcEMASeries };
