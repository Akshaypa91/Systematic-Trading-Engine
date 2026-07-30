// src/engine/intradayBacktester.js
// ─────────────────────────────────────────────────────────────────────────────
// Session-aware backtest for the 1-minute VWAP scalper, with costs reported as a
// separate line rather than buried inside the return.
//
// Split out of scripts/backtest-intraday.js so the CLI and the HTTP API run the
// SAME code — the lesson from strategyCore: one decision path, no drift.
//
// Reports gross → costs → net plus intraday buy & hold, because for a
// high-turnover strategy the frictions ARE the result. On real NSE large-caps
// this reliably shows costs dwarfing gross; that is information, not a bug.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const scalper = require('../strategies/intradayScalper');

/** Group a flat ascending bar array into per-session arrays by calendar date. */
function bySession(bars) {
  const map = new Map();
  for (const b of bars) {
    const day = String(b.date || b.t).slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(b);
  }
  return [...map.values()];
}

/**
 * Run the scalper over one symbol's 1-minute bars.
 * @returns {{trades:Array, gross:number, cost:number, net:number, wins:number, avgHeld:number}}
 */
function runSymbol(bars, { costBps = 18, warmup = 30, capitalPerTrade = 100000 } = {}) {
  const trades = [];
  for (const session of bySession(bars)) {
    if (session.length < warmup + 5) continue;
    let pos = null;

    for (let i = warmup; i < session.length; i++) {
      const bar = session[i];
      const price = Number(bar.close);
      if (!(price > 0)) continue;
      const sig = scalper.generateSignal(session.slice(0, i + 1), { roundTripBps: costBps });

      if (!pos && sig.signal === 'BUY') {
        pos = { entry: price, qty: Math.max(1, Math.floor(capitalPerTrade / price)),
          entryIdx: i, stop: sig.stop, target: sig.target, entryAt: bar.date };
        continue;
      }
      if (pos) {
        let exit = null, reason = null;
        if (Number(bar.low) <= pos.stop)          { exit = pos.stop;   reason = 'STOP'; }
        else if (Number(bar.high) >= pos.target)  { exit = pos.target; reason = 'TARGET'; }
        else if (sig.signal === 'SELL')           { exit = price;      reason = /Square-off/.test(sig.reason || '') ? 'SQUARE_OFF' : 'SIGNAL'; }
        else if (i === session.length - 1)        { exit = price;      reason = 'EOD'; }

        if (exit != null) {
          const notional = pos.qty * pos.entry;
          const gross = (exit - pos.entry) * pos.qty;
          const cost  = notional * (costBps / 10000);
          trades.push({
            entry: +pos.entry.toFixed(2), exit: +exit.toFixed(2), qty: pos.qty, reason,
            entryAt: pos.entryAt, exitAt: bar.date, heldBars: i - pos.entryIdx,
            grossPnl: +gross.toFixed(2), cost: +cost.toFixed(2), netPnl: +(gross - cost).toFixed(2),
          });
          pos = null;
        }
      }
    }
  }
  const gross = trades.reduce((a, t) => a + t.grossPnl, 0);
  const cost  = trades.reduce((a, t) => a + t.cost, 0);
  const wins  = trades.filter(t => t.netPnl > 0).length;
  const held  = trades.length ? trades.reduce((a, t) => a + t.heldBars, 0) / trades.length : 0;
  return {
    trades, wins,
    gross: +gross.toFixed(2), cost: +cost.toFixed(2), net: +(gross - cost).toFixed(2),
    winRatePct: trades.length ? +((wins / trades.length) * 100).toFixed(1) : 0,
    avgHeldBars: +held.toFixed(1),
  };
}

/** Benchmark: buy the first bar of each session, sell the last. */
function buyHoldIntraday(bars, costBps = 18, capitalPerTrade = 100000) {
  let gross = 0, cost = 0, sessions = 0;
  for (const session of bySession(bars)) {
    if (session.length < 2) continue;
    const a = Number(session[0].close), b = Number(session[session.length - 1].close);
    if (!(a > 0) || !(b > 0)) continue;
    const qty = Math.max(1, Math.floor(capitalPerTrade / a));
    gross += (b - a) * qty;
    cost  += qty * a * (costBps / 10000);
    sessions++;
  }
  return { sessions, gross: +gross.toFixed(2), cost: +cost.toFixed(2), net: +(gross - cost).toFixed(2) };
}

/**
 * Full run across several symbols.
 * @param {Object<string, Array>} series  symbol → ascending 1-minute bars
 */
function run(series, opts = {}) {
  const costBps = Number(opts.costBps ?? 18);
  const perSymbol = [];
  let gross = 0, cost = 0, trades = 0, wins = 0;

  for (const [symbol, bars] of Object.entries(series || {})) {
    const r = runSymbol(bars, { ...opts, costBps });
    const bh = buyHoldIntraday(bars, costBps);
    perSymbol.push({
      symbol, trades: r.trades.length, winRatePct: r.winRatePct,
      gross: r.gross, cost: r.cost, net: r.net, avgHeldBars: r.avgHeldBars,
      buyHoldNet: bh.net, sessions: bh.sessions,
      sampleTrades: r.trades.slice(0, 10),
    });
    gross += r.gross; cost += r.cost; trades += r.trades.length; wins += r.wins;
  }

  const net = +(gross - cost).toFixed(2);
  const costDragPct = gross !== 0 ? +((cost / Math.abs(gross)) * 100).toFixed(1) : null;
  return {
    costBps, perSymbol,
    totals: {
      trades, gross: +gross.toFixed(2), cost: +cost.toFixed(2), net,
      winRatePct: trades ? +((wins / trades) * 100).toFixed(1) : 0,
      costDragPct,
      // Indian intraday gains are short-term: 20% STCG on anything positive.
      netAfterTax: net > 0 ? +(net * 0.8).toFixed(2) : net,
    },
    verdict: trades === 0
      ? 'No trades — the cost gate rejected every setup. A valid result: no move was worth the frictions.'
      : (net > 0
        ? 'Net positive before tax. High turnover means costs remain the dominant risk.'
        : 'Net NEGATIVE — frictions consumed the signal. The normal outcome for retail scalping.'),
  };
}

module.exports = { run, runSymbol, buyHoldIntraday, bySession };
