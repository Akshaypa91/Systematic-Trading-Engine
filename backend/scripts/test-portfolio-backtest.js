// scripts/test-portfolio-backtest.js
// Invariant tests for the multi-symbol shared-capital backtester. Offline.
//   node scripts/test-portfolio-backtest.js
'use strict';
const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {};
const { runPortfolioBacktest } = require('../src/engine/portfolioBacktester');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

// Deterministic OHLC generator (trend + wave) so runs are reproducible.
function makeBars(n, seed) {
  const bars = []; let p = 100 + seed;
  const d0 = new Date('2022-01-03');
  for (let i = 0; i < n; i++) {
    const trend = i < n * 0.6 ? 0.25 : -0.2;
    const wave  = Math.sin((i + seed) / 7) * 1.8;
    p = Math.max(5, p + trend + wave);
    const c = +p.toFixed(2);
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    bars.push({ date: d.toISOString().slice(0, 10), open: c, high: +(c * 1.01).toFixed(2), low: +(c * 0.99).toFixed(2), close: c, volume: 1000 });
  }
  return bars;
}

const series = {
  RELIANCE: makeBars(200, 0),
  TCS:      makeBars(200, 3),
  INFY:     makeBars(200, 7),
};

(async () => {
  console.log('runPortfolioBacktest — invariants');
  const r = runPortfolioBacktest({ series, config: { initialCapital: 1_000_000, maxConcurrent: 2, sizingMethod: 'risk', warmup: 60 } });

  ok('returns summary + trades + equityCurve', r.summary && Array.isArray(r.trades) && Array.isArray(r.equityCurve), '');
  ok('equity curve has points', r.equityCurve.length > 0);
  ok('no NaN in equity', r.equityCurve.every(e => Number.isFinite(e.equity)));
  ok('final capital finite & > 0', Number.isFinite(r.summary.finalCapital) && r.summary.finalCapital > 0, String(r.summary.finalCapital));
  ok('metrics finite', [r.summary.totalReturnPct, r.summary.sharpeRatio, r.summary.maxDrawdownPct].every(Number.isFinite), JSON.stringify(r.summary));
  ok('every trade has numeric pnl', r.trades.every(t => Number.isFinite(t.pnl)));
  ok('win rate within 0..100', r.summary.winRatePct >= 0 && r.summary.winRatePct <= 100);
  ok('per-symbol P&L reported', typeof r.summary.bySymbol === 'object');

  // Shared-capital invariant: equity should never exceed what a single pool could
  // hold given we started at 1,000,000 and only trade (no external inflows) — i.e.
  // no impossible blow-up. (Sanity: finalCapital within a broad realistic band.)
  ok('no capital teleportation (finalCapital < 5× initial)', r.summary.finalCapital < 5_000_000, String(r.summary.finalCapital));

  console.log('concurrency cap holds');
  // Reconstruct max simultaneously-open positions from the trade log by scanning
  // overlapping [entryDate, exitDate] windows per day.
  const r1 = runPortfolioBacktest({ series, config: { maxConcurrent: 1, warmup: 60 } });
  const dates = [...new Set(Object.values(series).flat().map(b => b.date))].sort();
  let maxOpen = 0;
  for (const d of dates) {
    const open = r1.trades.filter(t => t.entryDate <= d && d < t.exitDate).length;
    if (open > maxOpen) maxOpen = open;
  }
  ok('maxConcurrent=1 never exceeds 1 open', maxOpen <= 1, `maxOpen=${maxOpen}`);

  console.log('empty series rejected');
  let threw = false;
  try { runPortfolioBacktest({ series: {} }); } catch { threw = true; }
  ok('empty series throws', threw);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
