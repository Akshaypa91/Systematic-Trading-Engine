// src/services/swingScanService.js
// "Fresh 52wk Breakout" swing strategy — by Akshay Pagare (Investors Way).
// Server-side batch scan across every instrument-mapped symbol. Mirrors the
// frontend evaluator (frontend/src/utils/swingStrategy.js) and the original
// TradingView Pine script 1:1, plus the Chartink ATR band filter.
//
// One scan at a time; results cached in memory until the next run.
'use strict';

const marketDataService = require('./marketDataService');
const symbols = require('../config/symbols');
const logger = require('../config/logger');

const DELAY_MS = 150;          // pacing between Upstox candle fetches
const CANDLE_DAYS = 400;       // calendar days → ~270 trading candles

// ── Math helpers (oldest→newest arrays) ───────────────────────────────────────
const last = (a) => a[a.length - 1];

function sma(values, len, offset = 0) {
  const end = values.length - offset;
  if (end < len) return null;
  let s = 0;
  for (let i = end - len; i < end; i++) s += values[i];
  return s / len;
}

function emaSeries(values, len) {
  if (values.length < len) return null;
  const k = 2 / (len + 1);
  let e = sma(values.slice(0, len), len);
  const out = new Array(values.length).fill(null);
  out[len - 1] = e;
  for (let i = len; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function atr14(candles, len = 14) {
  if (candles.length < len + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  let a = sma(trs.slice(0, len), len);
  for (let i = len; i < trs.length; i++) a = (a * (len - 1) + trs[i]) / len;
  return a;
}

function highest(values, len, offset = 0) {
  const end = values.length - offset;
  const start = Math.max(0, end - len);
  if (end <= start) return null;
  let m = -Infinity;
  for (let i = start; i < end; i++) if (values[i] > m) m = values[i];
  return m;
}

function lowest(values, len, offset = 0) {
  const end = values.length - offset;
  const start = Math.max(0, end - len);
  if (end <= start) return null;
  let m = Infinity;
  for (let i = start; i < end; i++) if (values[i] < m) m = values[i];
  return m;
}

// ── Strategy evaluation ───────────────────────────────────────────────────────
function evaluateSwing(candles) {
  if (!Array.isArray(candles) || candles.length < 210) {
    return { ok: false, reason: `insufficient candles (${candles?.length ?? 0})` };
  }

  const closes = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);
  const lows   = candles.map(c => c.l);
  const vols   = candles.map(c => c.v ?? 0);

  const close = last(closes);
  const prevClose = closes[closes.length - 2];
  const low = last(lows);
  const volume = last(vols);

  const sma50    = sma(closes, 50);
  const sma200   = sma(closes, 200);
  const sma50p5  = sma(closes, 50, 5);
  const sma200p5 = sma(closes, 200, 5);
  const volSma50 = sma(vols, 50);
  const atr = atr14(candles);
  const lookback = Math.min(252, candles.length - 1);
  const high52Prev = highest(highs, lookback, 1);
  const atrPct = atr != null ? atr / close : null;

  const checks = {
    price: close > 50,
    trend: close > sma200 && close > sma50 && sma50 > sma200,
    slope: sma50 > sma50p5 && sma200 > sma200p5,
    fresh: close >= high52Prev && prevClose < high52Prev,
    vol:   volSma50 != null && volume > volSma50 * 2,
    move:  close > prevClose * 1.005,
    liq:   volume * close > 20000000,
    atr:   atrPct != null && atrPct >= 0.015 && atrPct <= 0.05,
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const breakout = passed === Object.keys(checks).length;
  const coreTrend = checks.trend && checks.slope;

  const entry = close * 1.001;
  const sl = Math.max(low, lowest(lows, 5)) * 0.995;
  const slDist = entry - sl;
  const slPct = (slDist / entry) * 100;
  const t1 = entry + 1.5 * atr;
  const rr1 = slDist > 0 ? (t1 - entry) / slDist : 0;

  const ema10 = emaSeries(closes, 10);

  return {
    ok: true,
    verdict: breakout ? 'BREAKOUT' : coreTrend ? 'WATCHING' : 'NO_SETUP',
    close,
    passed,
    total: Object.keys(checks).length,
    checks,
    rr1: Number(rr1.toFixed(2)),
    slPct: Number(slPct.toFixed(2)),
    freshBreak: checks.fresh,
    trailExit: close < last(ema10) && prevClose < ema10[ema10.length - 2],
  };
}

// ── Scan state (module-level singleton) ───────────────────────────────────────
const state = {
  running: false,
  done: 0,
  total: 0,
  startedAt: null,
  finishedAt: null,
  hits: [],
  errors: 0,
  universe: 0,
};

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function runScan() {
  if (state.running) return { started: false, running: true };

  const universe = symbols.allSymbols();
  state.running = true;
  state.done = 0;
  state.total = universe.length;
  state.universe = universe.length;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.hits = [];
  state.errors = 0;

  // Fire-and-forget background loop; callers poll getState().
  (async () => {
    logger.info(`[SwingScan] Starting scan of ${universe.length} symbols`);
    for (const sym of universe) {
      try {
        const out = await marketDataService.getCandles(sym, { interval: 'day', days: CANDLE_DAYS });
        const rep = evaluateSwing(out?.candles || []);
        if (rep.ok && rep.verdict !== 'NO_SETUP') {
          state.hits.push({ symbol: sym, ...rep, checks: undefined, ok: undefined });
        }
      } catch (err) {
        state.errors += 1;
        logger.warn(`[SwingScan] ${sym}: ${err.message}`);
      }
      state.done += 1;
      await sleep(DELAY_MS);
    }
    state.hits.sort((a, b) =>
      a.verdict === b.verdict ? b.passed - a.passed : a.verdict === 'BREAKOUT' ? -1 : 1
    );
    state.running = false;
    state.finishedAt = new Date().toISOString();
    logger.info(`[SwingScan] Done — ${state.hits.length} candidates, ${state.errors} errors`);
  })().catch(err => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    logger.error(`[SwingScan] Fatal: ${err.message}`);
  });

  return { started: true, running: true };
}

function getState() {
  return {
    running: state.running,
    done: state.done,
    total: state.total,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    universe: state.universe,
    errors: state.errors,
    hits: state.hits,
  };
}

module.exports = { runScan, getState, evaluateSwing };
