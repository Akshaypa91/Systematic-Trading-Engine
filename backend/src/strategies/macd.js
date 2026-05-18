// src/strategies/macd.js
'use strict';
function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}
function calcEMASeries(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let ema = prices.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < prices.length; i++) { ema = prices[i] * k + ema * (1-k); result.push(ema); }
  return result;
}
function computeMACD(prices, fast=12, slow=26, signal=9) {
  if (prices.length < slow + signal) return { signal:'HOLD', confidence:0, macdLine:null, signalLine:null, histogram:null };
  const emaFast = calcEMASeries(prices, fast);
  const emaSlow = calcEMASeries(prices, slow);
  const minLen  = Math.min(emaFast.length, emaSlow.length);
  const macd    = emaFast.slice(emaFast.length - minLen).map((v,i) => v - emaSlow[emaSlow.length - minLen + i]);
  if (macd.length < signal) return { signal:'HOLD', confidence:0, macdLine:null, signalLine:null, histogram:null };
  const sigLine  = calcEMA(macd, signal);
  const macdLine = macd[macd.length - 1];
  const prevMACD = macd[macd.length - 2];
  const histogram= parseFloat((macdLine - sigLine).toFixed(4));
  const prevHist = parseFloat((prevMACD  - sigLine).toFixed(4));
  let sig = 'HOLD', confidence = 0;
  if (prevHist <= 0 && histogram > 0)      { sig = 'BUY';  confidence = 0.70; }
  else if (prevHist >= 0 && histogram < 0) { sig = 'SELL'; confidence = 0.70; }
  else if (histogram > 0 && macdLine > 0)  { sig = 'BUY';  confidence = 0.35; }
  else if (histogram < 0 && macdLine < 0)  { sig = 'SELL'; confidence = 0.35; }
  return { signal:sig, confidence:Math.min(confidence,0.95), macdLine:parseFloat(macdLine.toFixed(4)), signalLine:parseFloat(sigLine.toFixed(4)), histogram, bullish:histogram>0 };
}
module.exports = { computeMACD, calcEMA, calcEMASeries };
