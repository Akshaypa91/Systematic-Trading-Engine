// src/engine/crossSectionalMomentum.js
// ─────────────────────────────────────────────────────────────────────────────
// CROSS-SECTIONAL (RELATIVE) MOMENTUM — a structurally different approach from
// everything tested so far, not another indicator tweak.
//
// What we tested before were all TIME-SERIES signals: "is THIS stock's own
// history bullish?" (RSI level, its own MA cross, its own Z-score). This ranks
// every stock against EVERY OTHER stock and holds the top N. That is the
// Jegadeesh–Titman (1993) momentum anomaly — the most replicated cross-sectional
// effect in equity research, documented across decades and dozens of markets.
//
// Why it is worth one honest test here:
//   • Different mechanism → not a re-run of the same failed idea.
//   • LOW TURNOVER by construction (monthly rebalance, ~N positions). Costs and
//     India's 20% STCG are certain drags; alpha is not. Cutting 130 trades to
//     ~12 rebalances is a guaranteed improvement in net terms.
//   • Optional index regime filter (hold cash when the market is below its own
//     long MA) — historically the main defence against momentum crashes.
//
// This may still show no edge on NSE large caps. That is a valid outcome.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const _n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function _sharpe(rets) {
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(v);
  return sd > 0 ? +(m / sd * Math.sqrt(252)).toFixed(4) : 0;
}
function _maxDD(eq) {
  let peak = -Infinity, mdd = 0;
  for (const e of eq) { if (e > peak) peak = e; const dd = peak > 0 ? (peak - e) / peak : 0; if (dd > mdd) mdd = dd; }
  return +(mdd * 100).toFixed(4);
}

/**
 * @param {object} args
 *   series: { SYM: [{date, close}, ...] }  ascending
 *   config: { initialCapital, lookback, topN, rebalanceDays, warmup,
 *             slippagePct, regimeFilter, regimeMa }
 */
function runCrossSectional({ series = {}, config = {} } = {}) {
  const {
    initialCapital = 1_000_000,
    lookback       = 120,     // ~6 months momentum window
    topN           = 5,
    rebalanceDays  = 21,      // ~monthly
    warmup         = 210,
    slippagePct    = 0.0005,
    regimeFilter   = true,    // hold cash when the equal-weight index is weak
    regimeMa       = 200,
  } = config;

  const symbols = Object.keys(series).filter(s => Array.isArray(series[s]) && series[s].length > warmup + 5);
  if (symbols.length < topN + 1) throw new Error(`need > ${topN} symbols with history, got ${symbols.length}`);

  const idx = {}, closes = {};
  for (const s of symbols) {
    idx[s] = new Map(series[s].map((b, i) => [b.date, i]));
    closes[s] = series[s].map(b => _n(b.close));
  }
  const dates = [...new Set(symbols.flatMap(s => series[s].map(b => b.date)))].sort();

  let cash = initialCapital;
  let holdings = {};                    // sym → qty
  const equityCurve = [], dailyReturns = [], trades = [];
  let rebalances = 0, lastRebal = -Infinity;

  const priceAt = (s, d) => { const i = idx[s].get(d); return i == null ? null : closes[s][i]; };
  const momAt = (s, d) => {
    const i = idx[s].get(d);
    if (i == null || i < lookback) return null;
    const a = closes[s][i - lookback], b = closes[s][i];
    return a > 0 ? (b - a) / a : null;
  };

  // Equal-weight "index" level for the regime filter.
  const indexLevel = (d) => {
    const ps = symbols.map(s => priceAt(s, d)).filter(p => p > 0);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
  };
  const indexHistory = [];

  for (let di = 0; di < dates.length; di++) {
    const d = dates[di];
    const lvl = indexLevel(d);
    if (lvl != null) indexHistory.push(lvl);
    if (di < warmup) { equityCurve.push({ date: d, equity: +cash.toFixed(2) }); continue; }

    // ── Rebalance? ──
    if (di - lastRebal >= rebalanceDays) {
      lastRebal = di; rebalances++;

      // Regime: only deploy when the index is above its own long MA.
      let riskOn = true;
      if (regimeFilter && indexHistory.length >= regimeMa) {
        const ma = indexHistory.slice(-regimeMa).reduce((a, b) => a + b, 0) / regimeMa;
        riskOn = lvl != null && lvl > ma;
      }

      // Rank by momentum; pick the top N.
      const ranked = symbols
        .map(s => ({ s, m: momAt(s, d), p: priceAt(s, d) }))
        .filter(x => x.m != null && x.p > 0)
        .sort((a, b) => b.m - a.m);
      const target = riskOn ? ranked.slice(0, topN).filter(x => x.m > 0).map(x => x.s) : [];

      // Sell everything not in target.
      for (const s of Object.keys(holdings)) {
        if (target.includes(s)) continue;
        const p = priceAt(s, d); if (!(p > 0)) continue;
        const fill = p * (1 - slippagePct);
        cash += holdings[s] * fill;
        trades.push({ symbol: s, side: 'SELL', date: d, price: +fill.toFixed(2), qty: holdings[s] });
        delete holdings[s];
      }
      // Buy/equalise into target names.
      if (target.length) {
        const held = Object.keys(holdings);
        const equity = cash + held.reduce((a, s) => a + holdings[s] * (priceAt(s, d) || 0), 0);
        const per = equity / target.length;
        for (const s of target) {
          const p = priceAt(s, d); if (!(p > 0)) continue;
          const fill = p * (1 + slippagePct);
          const want = Math.floor(per / fill);
          const have = holdings[s] || 0;
          if (want > have) {
            const buy = want - have, cost = buy * fill;
            if (cost <= cash && buy > 0) {
              cash -= cost; holdings[s] = have + buy;
              trades.push({ symbol: s, side: 'BUY', date: d, price: +fill.toFixed(2), qty: buy });
            }
          }
        }
      }
    }

    // ── Mark to market ──
    let mtm = 0;
    for (const s of Object.keys(holdings)) { const p = priceAt(s, d); if (p > 0) mtm += holdings[s] * p; }
    const eq = cash + mtm;
    equityCurve.push({ date: d, equity: +eq.toFixed(2) });
    if (equityCurve.length >= 2) {
      const prev = equityCurve[equityCurve.length - 2].equity;
      dailyReturns.push(prev > 0 ? (eq - prev) / prev : 0);
    }
  }

  // Liquidate at the end.
  const last = dates[dates.length - 1];
  for (const s of Object.keys(holdings)) {
    const p = priceAt(s, last) || closes[s][closes[s].length - 1];
    if (p > 0) { cash += holdings[s] * p * (1 - slippagePct); }
    delete holdings[s];
  }

  const eqVals = equityCurve.map(e => e.equity);
  return {
    summary: {
      strategy: 'XS_MOMENTUM', symbols: symbols.length,
      initialCapital, finalCapital: +cash.toFixed(2),
      totalReturnPct: +(((cash - initialCapital) / initialCapital) * 100).toFixed(4),
      sharpeRatio: _sharpe(dailyReturns),
      maxDrawdownPct: _maxDD(eqVals),
      totalTrades: trades.length, rebalances,
      lookback, topN, rebalanceDays, regimeFilter,
    },
    trades, equityCurve,
  };
}

module.exports = { runCrossSectional };
