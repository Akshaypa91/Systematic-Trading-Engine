// src/strategies/vwap.js
'use strict';
function calcVWAPBands(bars, mult=1.5) {
  if (!bars || bars.length < 2) return null;
  let cumTPV=0, cumVol=0, cumTP2V=0;
  for (const b of bars) {
    const tp = (parseFloat(b.high)+parseFloat(b.low)+parseFloat(b.close))/3;
    const v  = parseFloat(b.volume)||0;
    cumTPV+=tp*v; cumVol+=v; cumTP2V+=tp*tp*v;
  }
  if (cumVol===0) return null;
  const vwap   = cumTPV/cumVol;
  const stdDev = Math.sqrt(Math.max(cumTP2V/cumVol - vwap*vwap, 0));
  return { vwap:+vwap.toFixed(2), upper1:+(vwap+stdDev).toFixed(2), lower1:+(vwap-stdDev).toFixed(2), upper2:+(vwap+mult*stdDev).toFixed(2), lower2:+(vwap-mult*stdDev).toFixed(2) };
}
function computeVWAP(bars, currentPrice) {
  if (!bars||bars.length<5||!currentPrice) return { signal:'HOLD', confidence:0, vwap:null };
  const bands = calcVWAPBands(bars);
  if (!bands) return { signal:'HOLD', confidence:0, vwap:null };
  const p = parseFloat(currentPrice);
  let signal='HOLD', confidence=0;
  if (p<=bands.lower2)      { signal='BUY';  confidence=0.75; }
  else if (p<=bands.lower1) { signal='BUY';  confidence=0.55; }
  else if (p>=bands.upper2) { signal='SELL'; confidence=0.75; }
  else if (p>=bands.upper1) { signal='SELL'; confidence=0.55; }
  return { signal, confidence:Math.min(confidence,0.95), ...bands, aboveVWAP:p>bands.vwap };
}
module.exports = { calcVWAPBands, computeVWAP };
