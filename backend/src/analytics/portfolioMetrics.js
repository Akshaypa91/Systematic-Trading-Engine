analytics// src/analytics/portfolioMetrics.js
'use strict';
const db = require('../config/database');
function mean(a) { return a.reduce((s,v)=>s+v,0)/a.length; }
function stdDev(a) { const m=mean(a); return Math.sqrt(a.map(x=>(x-m)**2).reduce((s,v)=>s+v,0)/a.length); }
function calcCAGR(init, final, days) { if(!init||!days) return 0; return +((Math.pow(final/init,1/(days/252))-1)*100).toFixed(4); }
function calcSharpe(r, rf=0.065) { if(!r||r.length<2) return 0; const ex=r.map(v=>v-rf/252); const v=stdDev(ex); return v?+((mean(ex)/v)*Math.sqrt(252)).toFixed(4):0; }
function calcSortino(r, rf=0.065) { if(!r||r.length<2) return 0; const ex=r.map(v=>v-rf/252); const down=ex.filter(v=>v<0); if(!down.length) return mean(ex)>0?99:0; const dv=Math.sqrt(down.map(v=>v**2).reduce((s,v)=>s+v,0)/down.length)*Math.sqrt(252); return dv?+((mean(ex)*252)/dv).toFixed(4):0; }
function calcMaxDrawdown(eq) { if(!eq||eq.length<2) return {maxDrawdown:0,maxDrawdownPct:0}; let peak=eq[0],dd=0; for(const v of eq){if(v>peak)peak=v;const d=(peak-v)/peak;if(d>dd)dd=d;} return {maxDrawdown:+((peak*dd)).toFixed(2),maxDrawdownPct:+(dd*100).toFixed(4)}; }
function calcTradeStats(trades) {
  if(!trades||!trades.length) return {winRate:0,profitFactor:0,avgWin:0,avgLoss:0,expectancy:0,totalTrades:0};
  const closed=trades.filter(t=>t.pnl!=null);
  const wins=closed.filter(t=>t.pnl>0), losses=closed.filter(t=>t.pnl<0);
  const gw=wins.reduce((s,t)=>s+t.pnl,0), gl=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const wr=closed.length?wins.length/closed.length:0;
  const aw=wins.length?gw/wins.length:0, al=losses.length?gl/losses.length:0;
  return {totalTrades:closed.length,winCount:wins.length,lossCount:losses.length,winRate:+(wr*100).toFixed(2),profitFactor:gl?+(gw/gl).toFixed(4):gw>0?99:0,avgWin:+aw.toFixed(2),avgLoss:+al.toFixed(2),expectancy:+(wr*aw-(1-wr)*al).toFixed(2)};
}
function equityToDailyReturns(eq) { const r=[]; for(let i=1;i<eq.length;i++){if(eq[i-1]>0)r.push((eq[i]-eq[i-1])/eq[i-1]);} return r; }
async function getBenchmarkReturn(start,end) { try { const [rows]=await db.query(`SELECT close FROM daily_prices WHERE symbol='NIFTY50' AND date BETWEEN ? AND ? ORDER BY date`,[start,end]); if(rows.length<2)return null; return +((rows[rows.length-1].close-rows[0].close)/rows[0].close*100).toFixed(4); } catch{return null;} }
async function computeFullMetrics({equityCurve,trades,initialCapital,startDate,endDate}) {
  const final=equityCurve[equityCurve.length-1]||initialCapital;
  const days=equityCurve.length, r=equityToDailyReturns(equityCurve);
  const {maxDrawdown,maxDrawdownPct}=calcMaxDrawdown(equityCurve);
  const cagr=calcCAGR(initialCapital,final,days);
  const benchmark=await getBenchmarkReturn(startDate,endDate);
  return { totalReturn:+((final-initialCapital)/initialCapital*100).toFixed(4), cagr, sharpe:calcSharpe(r), sortino:calcSortino(r), calmar:maxDrawdownPct>0?+(cagr/maxDrawdownPct).toFixed(4):0, maxDrawdown, maxDrawdownPct, volatility:+(stdDev(r)*Math.sqrt(252)*100).toFixed(4), alpha:benchmark!=null?+(cagr-benchmark).toFixed(4):null, benchmarkReturn:benchmark, ...calcTradeStats(trades), initialCapital, finalCapital:+final.toFixed(2), tradingDays:days };
}
module.exports = { calcCAGR, calcSharpe, calcSortino, calcMaxDrawdown, calcTradeStats, equityToDailyReturns, getBenchmarkReturn, computeFullMetrics };
