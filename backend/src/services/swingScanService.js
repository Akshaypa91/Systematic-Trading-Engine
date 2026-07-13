// src/services/swingScanService.js
// "Fresh 52wk Breakout" swing scan — ADP Way, strategy by Akshay Pagare.
//
// STRICT MODE: a stock is reported ONLY when EVERY rule passes — no partial
// tiers, nothing added beyond the strategy:
//   close > sma200 && close > sma50 && sma50 > sma200        (trend_ok)
//   sma50 > sma50[5]  && sma200 > sma200[5]                  (rising DMAs)
//   close >= high_52[1] && close[1] < high_52[1]             (fresh_break)
//   volume > 2.0 × sma(volume, 50)                           (vol_ok)
//   close > close[1] × 1.005                                 (move_ok)
//   volume × close > ₹2 Cr                                   (liq_ok)
//   close > ₹50                                              (price_ok)
//   1.5% ≤ ATR(14)/close ≤ 5%                                (ATR band)
//
// Universe: ALL NSE-listed equities from Upstox's official instrument master
// (assets.upstox.com NSE.json.gz, cached 24h). Falls back to the hand-mapped
// symbols in config/symbols.js if the master can't be fetched.
'use strict';

const axios = require('axios');
const zlib = require('zlib');
const symbols = require('../config/symbols');
const logger = require('../config/logger');
const db = require('../config/database');

const MASTER_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const MASTER_TTL_MS = 24 * 60 * 60 * 1000;
const CANDLE_DAYS = 400;            // calendar days → ~270 trading candles
const CONCURRENCY = 6;
const STAGGER_MS = 40;              // pacing per worker between requests
const TIMEOUT_MS = 10000;
const QUOTE_CHUNK = 200;            // batch size for the quote pre-filter

function _getUpstoxAuth() {
  try { return require('./upstoxAuth'); } catch { return null; }
}

// ── NSE instrument master (all listed equities) ───────────────────────────────
let _master = { at: 0, list: [] };

async function getUniverse() {
  if (Date.now() - _master.at < MASTER_TTL_MS && _master.list.length) return _master.list;
  try {
    const res = await axios.get(MASTER_URL, { responseType: 'arraybuffer', timeout: 30000 });
    const json = JSON.parse(zlib.gunzipSync(Buffer.from(res.data)).toString('utf8'));
    const list = [];
    for (const e of json) {
      const seg = e.segment || e.exchange_segment;
      const type = e.instrument_type || e.instrumentType;
      const sym = e.trading_symbol || e.tradingsymbol;
      const key = e.instrument_key || e.instrumentKey;
      if (seg === 'NSE_EQ' && type === 'EQ' && sym && key) {
        list.push({ symbol: sym, key });
      }
    }
    if (list.length > 100) {
      _master = { at: Date.now(), list };
      logger.info(`[SwingScan] NSE instrument master loaded — ${list.length} equities`);
      return list;
    }
    throw new Error(`master parse yielded only ${list.length} equities`);
  } catch (err) {
    logger.warn(`[SwingScan] Instrument master unavailable (${err.message}) — falling back to mapped symbols`);
    return symbols.allSymbols().map(s => ({ symbol: s, key: symbols.toUpstox(s) })).filter(e => e.key);
  }
}

// ── Quote pre-filter ──────────────────────────────────────────────────────────
// Three of the strategy's rules need only the latest quote:
//   price_ok  ltp > ₹50
//   liq_ok    volume × ltp > ₹2 Cr
//   move_ok   ltp > prev close × 1.005   (prev close = ltp − net_change)
// Batch quotes (200 instruments/call) knock out ~90% of the market in ~12
// requests, so full candle history is fetched only for the survivors.
// This is a strict SUBSET of the rules — it can never change the results.
// On any chunk failure we fail OPEN (keep those symbols for the full check).
async function prefilterUniverse(universe, token, sleep) {
  const survivors = [];
  const headers = { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' };
  for (let i = 0; i < universe.length; i += QUOTE_CHUNK) {
    const chunk = universe.slice(i, i + QUOTE_CHUNK);
    try {
      const url = 'https://api.upstox.com/v2/market-quote/quotes?instrument_key='
        + encodeURIComponent(chunk.map(e => e.key).join(','));
      const res = await axios.get(url, { headers, timeout: 20000 });
      const data = res.data?.data || {};
      // Response keys vary ('SEG:ISIN' or 'SEG:SYMBOL') — index both ways.
      const byKey = {};
      for (const [k, v] of Object.entries(data)) {
        byKey[k.replace(':', '|')] = v;
        const part = k.split(':')[1];
        if (part) byKey[part] = v;
      }
      for (const e of chunk) {
        const q = byKey[e.key] || byKey[e.symbol];
        if (!q) continue; // no quote at all → cannot pass liquidity anyway
        const ltp = Number(q.last_price);
        const vol = Number(q.volume);
        const prevClose = ltp - Number(q.net_change ?? 0);
        if (!isFinite(ltp) || !isFinite(vol)) continue;
        if (ltp > 50 && vol * ltp > 20000000 && prevClose > 0 && ltp > prevClose * 1.005) {
          survivors.push(e);
        }
      }
      await sleep(120);
    } catch (err) {
      logger.warn(`[SwingScan] prefilter chunk ${i / QUOTE_CHUNK + 1} failed (${err.message}) — keeping ${chunk.length} symbols for full check`);
      survivors.push(...chunk);
    }
  }
  return survivors;
}

// ── Direct daily-candle fetch by instrument key ───────────────────────────────
async function fetchDailyCandles(instrumentKey, token) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(Date.now() - CANDLE_DAYS * 24 * 60 * 60 * 1000);
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrumentKey)}/day/${fmt(to)}/${fmt(from)}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });
  return (res.data?.data?.candles || [])
    .map(c => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }))
    .filter(c => isFinite(c.c))
    .sort((a, b) => new Date(a.t) - new Date(b.t));
}

// ── Math (oldest→newest arrays) ───────────────────────────────────────────────
const last = (a) => a[a.length - 1];

function sma(values, len, offset = 0) {
  const end = values.length - offset;
  if (end < len) return null;
  let s = 0;
  for (let i = end - len; i < end; i++) s += values[i];
  return s / len;
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

// ── Strategy — every rule must pass (strict) ──────────────────────────────────
function evaluateSwing(candles) {
  if (!Array.isArray(candles) || candles.length < 210) return { ok: false };

  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  const vols = candles.map(c => c.v ?? 0);

  const close = last(closes);
  const prevClose = closes[closes.length - 2];
  const low = last(lows);
  const volume = last(vols);

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma50p5 = sma(closes, 50, 5);
  const sma200p5 = sma(closes, 200, 5);
  const volSma50 = sma(vols, 50);
  const atr = atr14(candles);
  const lookback = Math.min(252, candles.length - 1);
  const high52Prev = highest(highs, lookback, 1);
  const atrPct = atr != null ? atr / close : null;

  const breakout =
    close > 50 &&
    close > sma200 && close > sma50 && sma50 > sma200 &&
    sma50 > sma50p5 && sma200 > sma200p5 &&
    close >= high52Prev && prevClose < high52Prev &&
    volSma50 != null && volume > volSma50 * 2 &&
    close > prevClose * 1.005 &&
    volume * close > 20000000 &&
    atrPct != null && atrPct >= 0.015 && atrPct <= 0.05;

  if (!breakout) return { ok: true, breakout: false };

  const entry = close * 1.001;
  const sl = Math.max(low, lowest(lows, 5)) * 0.995;
  const slDist = entry - sl;

  return {
    ok: true,
    breakout: true,
    signalDate: String(last(candles).t).slice(0, 10),
    close,
    entry: Number(entry.toFixed(2)),
    sl: Number(sl.toFixed(2)),
    slPct: Number(((slDist / entry) * 100).toFixed(2)),
    t1: Number((entry + 1.5 * atr).toFixed(2)),
    t2: Number((entry + 3.0 * atr).toFixed(2)),
    rr1: Number((slDist > 0 ? (entry + 1.5 * atr - entry) / slDist : 0).toFixed(2)),
    rr2: Number((slDist > 0 ? (entry + 3.0 * atr - entry) / slDist : 0).toFixed(2)),
  };
}

// ── Signal history persistence (TiDB) ─────────────────────────────────────────
let _tableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS swing_signals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      signal_date DATE NOT NULL,
      symbol VARCHAR(40) NOT NULL,
      close_price DECIMAL(14,2),
      entry DECIMAL(14,2),
      sl DECIMAL(14,2),
      sl_pct DECIMAL(7,2),
      t1 DECIMAL(14,2),
      t2 DECIMAL(14,2),
      rr1 DECIMAL(7,2),
      rr2 DECIMAL(7,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_signal (signal_date, symbol)
    )
  `);
  _tableReady = true;
}

async function persistHits(hits) {
  if (!hits.length) return;
  try {
    await ensureTable();
    for (const h of hits) {
      // INSERT IGNORE: re-scanning the same day never duplicates a signal
      await db.query(
        `INSERT IGNORE INTO swing_signals
           (signal_date, symbol, close_price, entry, sl, sl_pct, t1, t2, rr1, rr2)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [h.signalDate, h.symbol, h.close, h.entry, h.sl, h.slPct, h.t1, h.t2, h.rr1, h.rr2]
      );
    }
    logger.info(`[SwingScan] Persisted ${hits.length} signal(s) to history`);
  } catch (err) {
    logger.warn(`[SwingScan] History persist failed (non-fatal): ${err.message}`);
  }
}

async function getHistory({ limit = 200 } = {}) {
  await ensureTable();
  const [rows] = await db.query(
    `SELECT signal_date, symbol, close_price, entry, sl, sl_pct, t1, t2, rr1, rr2, created_at
       FROM swing_signals
      ORDER BY signal_date DESC, rr1 DESC
      LIMIT ?`,
    [Math.min(Number(limit) || 200, 500)]
  );
  return rows;
}

// ── Scan state ────────────────────────────────────────────────────────────────
const state = {
  running: false, done: 0, total: 0,
  startedAt: null, finishedAt: null,
  hits: [], errors: 0, universe: 0, error: null,
};

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function runScan() {
  if (state.running) return { started: false, running: true };

  const token = _getUpstoxAuth()?.getAccessToken?.();
  if (!token) {
    state.error = 'Upstox not authenticated — connect the broker to scan';
    return { started: false, running: false, error: state.error };
  }

  const universe = await getUniverse();
  state.running = true;
  state.done = 0;
  state.total = universe.length;
  state.universe = universe.length;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.hits = [];
  state.errors = 0;
  state.error = null;

  (async () => {
    logger.info(`[SwingScan] Scanning ${universe.length} NSE equities (strict — all rules must pass)`);

    // Phase 1: batch-quote pre-filter (price / liquidity / up-move) — cheap.
    const survivors = await prefilterUniverse(universe, token, sleep);
    state.done = universe.length - survivors.length; // skipped = already ruled out
    logger.info(`[SwingScan] Pre-filter: ${survivors.length}/${universe.length} need full history`);

    // Phase 2: full candle history + remaining rules for the survivors.
    let idx = 0;
    async function worker() {
      for (;;) {
        const i = idx++;
        if (i >= survivors.length) return;
        const { symbol, key } = survivors[i];
        try {
          const candles = await fetchDailyCandles(key, token);
          const rep = evaluateSwing(candles);
          if (rep.ok && rep.breakout) {
            state.hits.push({ symbol, verdict: 'BREAKOUT', ...rep, ok: undefined, breakout: undefined });
            logger.info(`[SwingScan] BREAKOUT: ${symbol} @ ${rep.close}`);
          }
        } catch (err) {
          state.errors += 1;
          if (err.response?.status === 429) await sleep(2000); // back off on rate limit
        }
        state.done += 1;
        await sleep(STAGGER_MS);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.hits.sort((a, b) => b.rr1 - a.rr1);
    state.running = false;
    state.finishedAt = new Date().toISOString();
    logger.info(`[SwingScan] Done — ${state.hits.length} fresh breakouts, ${state.errors} fetch errors`);
    await persistHits(state.hits);
  })().catch(err => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    state.error = err.message;
    logger.error(`[SwingScan] Fatal: ${err.message}`);
  });

  return { started: true, running: true };
}

function getState() {
  return { ...state };
}

module.exports = { runScan, getState, getHistory, evaluateSwing };
