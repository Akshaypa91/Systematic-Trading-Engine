// src/engine/autoPaperTrader.js
// ─────────────────────────────────────────────────────────────────────────────
// Automatic paper trading on the PORTFOLIO THE UI ACTUALLY SHOWS.
//
// The bug this fixes: simulationEngine._tick() already had auto-entry and
// auto-exit logic, but it operated on simulationEngine's own IN-MEMORY
// `_portfolios` Map. The UI (/sim/portfolio → portfolioState → DB) shows a
// completely different, DB-backed portfolio that only ever received MANUAL
// trades. So the engine appeared to do nothing: every position a user saw was
// one they had opened by hand, and the engine's trades were invisible.
//
// This module runs the same decision logic against the DB portfolio via
// portfolioState.executeBuy/executeSell — the exact path manual trades use — so
// automatic trades appear in the same positions list, history and P&L.
//
// Entries : strategyCore signal = BUY and confidence >= threshold, no existing
//           position, position cap not reached, cash available.
// Exits   : stop-loss / take-profit / SELL signal — evaluated on every tick.
//
// Paper only. It never touches the broker. Gated by AUTO_PAPER_ENABLED.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const portfolioState = require('../portfolio/portfolioState');
const strategyCore   = require('./strategyCore');
const marketData     = require('../services/marketDataService');
const dataStore      = require('../data/dataStore');
const logger         = require('../config/logger');

const ENABLED       = process.env.AUTO_PAPER_ENABLED !== 'false';   // default ON (paper is safe)
const STRATEGY      = process.env.AUTO_PAPER_STRATEGY || 'AGGREGATED';
const MIN_CONF      = parseFloat(process.env.AUTO_PAPER_MIN_CONFIDENCE || '0.35');
const STOP_PCT      = parseFloat(process.env.AUTO_PAPER_SL_PCT || '0.05');   // 5% — 2% was inside noise
const TARGET_PCT    = parseFloat(process.env.AUTO_PAPER_TP_PCT || '0');      // 0 = no target, exit on signal
const MAX_POSITIONS = parseInt(process.env.AUTO_PAPER_MAX_POSITIONS || '5', 10);
const ALLOC_PCT     = parseFloat(process.env.AUTO_PAPER_ALLOC_PCT || '0.10'); // 10% of capital per trade

// Remember the entry-time stop/target per user+symbol (positions table has no
// SL/TP columns; keeping it here avoids a migration for a paper-only feature).
const _brackets = new Map();     // `${userId}:${symbol}` → { stop, target, openedAt }
const bkey = (u, s) => `${u ?? 'anon'}:${s}`;

// Minimum holding period. Without it a single bad tick round-trips a position in
// seconds (observed: four trades opened and closed within 13–17s), which burns
// costs and makes the trade log meaningless.
const MIN_HOLD_MS = parseInt(process.env.AUTO_PAPER_MIN_HOLD_MS || '900000', 10);   // 15 min

async function _closes(symbol, lookback = 260) {
  // Prefer stored history; fall back to (corp-action adjusted) broker candles.
  try {
    const bars = await dataStore.getRecentPrices(symbol, lookback);
    if (bars?.length >= 60) return bars.map(b => Number(b.close)).filter(Number.isFinite);
  } catch (_) {}
  try {
    const cd = await marketData.getCandles(symbol, { interval: 'day', days: 400 });
    return (cd?.candles || []).map(c => Number(c.c)).filter(Number.isFinite);
  } catch (_) { return []; }
}

// Only REAL prices may drive paper trades. Mixing a simulated entry price with a
// real exit price produced instant phantom stop-outs: e.g. TCS entered at a
// SIM ₹4,191 then "stopped out" at the real ₹2,431 seconds later (−41%), and
// KOTAKBANK entered ₹1,948 → exited ₹389 (−80%). Positions held 13–17 seconds.
// A trade log built from two different price universes is worthless, so refuse
// to act unless the quote came from a live provider.
const REAL_SOURCE = /^LIVE_|^UPSTOX/i;

async function _price(symbol) {
  try {
    const r = await marketData.getLivePrice(symbol);
    const p = Number(r?.price);
    if (!(Number.isFinite(p) && p > 0)) return null;
    const src = String(r?.source || '');
    if (!REAL_SOURCE.test(src)) return null;      // SIM / UNAVAILABLE → don't trade
    return p;
  } catch (_) { return null; }
}

// NSE cash hours (IST). The scheduler job is already gated, but the manual
// /api/sim/auto-trade endpoint is not — and after hours the price chain is far
// more likely to serve stale or simulated values.
function _isMarketOpen(now = Date.now()) {
  const ist  = new Date(now + 5.5 * 60 * 60 * 1000);
  const day  = ist.getUTCDay();
  const hhmm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && hhmm >= 915 && hhmm <= 1530;
}

// A quote that moved impossibly far from our entry is bad data, not a loss.
// Never exit on it — flag and skip so a feed glitch can't wipe the book.
const MAX_SANE_MOVE = parseFloat(process.env.AUTO_PAPER_MAX_MOVE || '0.35');   // 35%
function _isSanePrice(price, entry) {
  if (!(entry > 0) || !(price > 0)) return false;
  return Math.abs(price - entry) / entry <= MAX_SANE_MOVE;
}

/**
 * One pass for one user's paper portfolio.
 * @returns {{entries, exits, skipped, errors}}
 */
async function runOnce(userId, symbols, opts = {}) {
  if (!ENABLED) return { enabled: false, entries: 0, exits: 0, skipped: 0, errors: 0 };
  // Refuse to trade outside market hours unless explicitly forced. After 15:30
  // the price chain can serve stale/simulated values, which is exactly how the
  // 13-second phantom stop-outs happened.
  if (!_isMarketOpen() && !opts.force) {
    return { entries: 0, exits: 0, skipped: 0, errors: 0, reason: 'market-closed' };
  }
  const watch = (symbols || []).map(s => String(s).toUpperCase());
  if (!watch.length) return { entries: 0, exits: 0, skipped: 0, errors: 0 };

  let state;
  try { state = await portfolioState.getState(userId); } catch (e) { return { entries: 0, exits: 0, skipped: 0, errors: 1, error: e.message }; }
  if (!state?.initialized) return { entries: 0, exits: 0, skipped: 0, errors: 0, reason: 'portfolio-not-initialized' };

  let entries = 0, exits = 0, skipped = 0, errors = 0;
  const positions = state.positions || {};

  // ── 1. EXITS first (free up capital before considering new entries) ─────────
  for (const [symbol, pos] of Object.entries(positions)) {
    const qty = Number(pos.qty); if (!(qty > 0)) continue;
    const price = await _price(symbol); if (!price) { skipped++; continue; }
    const entry = Number(pos.entryPrice) || price;
    const br = _brackets.get(bkey(userId, symbol)) || {
      stop:   STOP_PCT   > 0 ? entry * (1 - STOP_PCT)   : 0,
      target: TARGET_PCT > 0 ? entry * (1 + TARGET_PCT) : 0,
      openedAt: null,
    };
    // Respect the minimum holding period (skips SL/TP thrash on one bad tick).
    if (br.openedAt && (Date.now() - br.openedAt) < MIN_HOLD_MS) { skipped++; continue; }

    // Bad-data guard: an impossible jump from entry is a feed problem, not a
    // real loss. Skip instead of liquidating the position on garbage.
    if (!_isSanePrice(price, entry)) {
      skipped++;
      logger.warn(`[AutoPaper] ${symbol}: price ₹${price} vs entry ₹${entry} exceeds ${(MAX_SANE_MOVE * 100).toFixed(0)}% — treating as bad data, no exit`);
      continue;
    }

    let reason = null;
    if (br.stop   > 0 && price <= br.stop)   reason = 'STOP_LOSS';
    else if (br.target > 0 && price >= br.target) reason = 'TAKE_PROFIT';
    else {
      const closes = await _closes(symbol);
      if (closes.length >= 60) {
        const sig = strategyCore.evaluate(STRATEGY, closes, { method: 'weighted', symbol });
        if (sig.signal === 'SELL' && Number(sig.confidence) >= MIN_CONF) reason = 'SIGNAL';
      }
    }
    if (!reason) continue;

    try {
      await portfolioState.executeSell(symbol, qty, price, 'AUTO', userId);
      _brackets.delete(bkey(userId, symbol));
      exits++;
      logger.info(`[AutoPaper] EXIT ${reason} ${qty}×${symbol} @₹${price} (user ${userId})`);
    } catch (e) { errors++; logger.warn(`[AutoPaper] exit ${symbol}: ${e.message}`); }
  }

  // ── 2. ENTRIES ─────────────────────────────────────────────────────────────
  let fresh;
  try { fresh = await portfolioState.getState(userId); } catch { fresh = state; }
  const held = fresh.positions || {};
  let openCount = Object.values(held).filter(p => Number(p.qty) > 0).length;
  let capital = Number(fresh.capital) || 0;

  for (const symbol of watch) {
    if (openCount >= MAX_POSITIONS) break;
    if (Number(held[symbol]?.qty) > 0) continue;

    const closes = await _closes(symbol);
    if (closes.length < 60) { skipped++; continue; }
    const sig = strategyCore.evaluate(STRATEGY, closes, { method: 'weighted', symbol });
    if (sig.signal !== 'BUY' || !(Number(sig.confidence) >= MIN_CONF)) { skipped++; continue; }

    const price = await _price(symbol); if (!price) { skipped++; continue; }
    const qty = Math.floor((capital * ALLOC_PCT) / price);
    if (qty < 1) { skipped++; continue; }

    try {
      await portfolioState.executeBuy(symbol, qty, price, 'AUTO', userId);
      _brackets.set(bkey(userId, symbol), {
        stop:   STOP_PCT   > 0 ? price * (1 - STOP_PCT)   : 0,
        target: TARGET_PCT > 0 ? price * (1 + TARGET_PCT) : 0,
        openedAt: Date.now(),
      });
      capital -= qty * price;
      openCount++; entries++;
      logger.info(`[AutoPaper] ENTRY BUY ${qty}×${symbol} @₹${price} conf=${sig.confidence} (user ${userId})`);
    } catch (e) { errors++; logger.warn(`[AutoPaper] entry ${symbol}: ${e.message}`); }
  }

  return { entries, exits, skipped, errors, strategy: STRATEGY, openCount };
}

function getBracket(userId, symbol) { return _brackets.get(bkey(userId, symbol)) || null; }
function getConfig() {
  return { ENABLED, STRATEGY, MIN_CONF, STOP_PCT, TARGET_PCT, MAX_POSITIONS, ALLOC_PCT,
    MIN_HOLD_MS, MAX_SANE_MOVE, marketOpen: _isMarketOpen(), realPricesOnly: true };
}

module.exports = { runOnce, getBracket, getConfig, ENABLED };
