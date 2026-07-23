// src/data/corporateActions.js
// ─────────────────────────────────────────────────────────────────────────────
// Corporate-actions adjustment for historical prices (splits, bonuses,
// dividends). Raw exchange candles are NOT continuous across an ex-date — a 1:1
// bonus halves the price overnight — which breaks indicators, backtests and
// P&L (this is the root cause of the RELIANCE entry ₹2,606 vs LTP ₹1,327
// artifact). We back-adjust: every candle on or before an ex-date is multiplied
// by that action's `factor` (and volume divided by it), so the series reads on
// today's share basis.
//
// Cumulative rule: a candle at date D is multiplied by the product of the
// factors of every action whose ex_date is AFTER D.
//
// Design notes:
//  • DB-backed (corporate_actions table) with an in-memory SEED fallback so it
//    works before the migration is applied and if the table is empty.
//  • Symbols with no actions pass through untouched (cheap, no allocation).
//  • Gated by CORP_ACTION_ADJUST (default on). Turn off if your price source is
//    already adjusted to avoid double-adjustment.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

const ENABLED = process.env.CORP_ACTION_ADJUST !== 'false';

// In-memory fallback used when the DB table is missing/empty. Keep verified
// actions only. factor = price multiplier applied on/before ex_date.
//   bonus a:b -> b/(a+b) ; split old_fv->new_fv -> new_fv/old_fv
const SEED = {
  RELIANCE: [
    { ex_date: '2024-10-28', action_type: 'BONUS', factor: 0.5, ratio_text: '1:1 bonus' },
  ],
};

// symbol -> { actions: [...], loadedAt: ms }
const _cache = new Map();
const TTL_MS = 10 * 60 * 1000;   // re-read actions every 10 min

function _normalize(rows) {
  return (rows || [])
    .map(r => ({
      ex_date:     typeof r.ex_date === 'string' ? r.ex_date.slice(0, 10)
                 : r.ex_date instanceof Date ? r.ex_date.toISOString().slice(0, 10)
                 : String(r.ex_date).slice(0, 10),
      action_type: String(r.action_type || '').toUpperCase(),
      factor:      Number(r.factor),
      ratio_text:  r.ratio_text || null,
    }))
    .filter(a => a.ex_date && isFinite(a.factor) && a.factor > 0 && a.factor !== 1)
    .sort((a, b) => (a.ex_date < b.ex_date ? -1 : 1));
}

// Load actions for a symbol (DB → seed fallback), cached.
async function getActions(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return [];
  const hit = _cache.get(sym);
  if (hit && Date.now() - hit.loadedAt < TTL_MS) return hit.actions;

  let actions = [];
  try {
    const [rows] = await db.query(
      'SELECT ex_date, action_type, factor, ratio_text FROM corporate_actions WHERE symbol = ? ORDER BY ex_date ASC',
      [sym]
    );
    actions = _normalize(rows);
  } catch (e) {
    // Table may not exist yet — fall back to seed silently (debug only).
    logger.debug(`[CorpActions] DB read failed for ${sym}: ${e.message}`);
  }
  if (actions.length === 0 && SEED[sym]) actions = _normalize(SEED[sym]);

  _cache.set(sym, { actions, loadedAt: Date.now() });
  return actions;
}

// Cumulative price multiplier for a candle dated `dateStr` (YYYY-MM-DD).
// Product of factors of all actions with ex_date strictly after the candle.
function _factorAt(dateStr, actions) {
  let f = 1;
  for (const a of actions) if (a.ex_date > dateStr) f *= a.factor;
  return f;
}

// Extract a YYYY-MM-DD key from a candle's date/time field.
function _dateKey(c) {
  const v = c.t ?? c.date ?? c.time ?? c.timestamp;
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * Back-adjust a candle array in place-safe (returns a new array).
 * Candles may be shaped {t,o,h,l,c,v} (marketData) or {date,open,high,low,close,volume}
 * (dataStore) — both are handled.
 * @param {string} symbol
 * @param {Array} candles ascending by date
 * @returns {Promise<{candles: Array, adjusted: boolean, actions: Array}>}
 */
async function adjustCandles(symbol, candles) {
  if (!ENABLED || !Array.isArray(candles) || candles.length === 0) {
    return { candles, adjusted: false, actions: [] };
  }
  const actions = await getActions(symbol);
  if (actions.length === 0) return { candles, adjusted: false, actions: [] };

  // Only adjust candles older than the newest ex-date; nothing after it changes.
  const lastEx = actions[actions.length - 1].ex_date;
  const out = candles.map(c => {
    const dk = _dateKey(c);
    if (!dk || dk > lastEx) return c;
    const f = _factorAt(dk, actions);
    if (f === 1) return c;
    const mul = (x) => (isFinite(Number(x)) ? Number(x) * f : x);
    const divVol = (x) => (isFinite(Number(x)) ? Math.round(Number(x) / f) : x);
    // Support both candle shapes without dropping unknown fields.
    const adj = { ...c };
    if ('o' in c) { adj.o = mul(c.o); adj.h = mul(c.h); adj.l = mul(c.l); adj.c = mul(c.c); if ('v' in c) adj.v = divVol(c.v); }
    if ('open' in c) { adj.open = mul(c.open); adj.high = mul(c.high); adj.low = mul(c.low); adj.close = mul(c.close); if ('volume' in c) adj.volume = divVol(c.volume); }
    return adj;
  });
  return { candles: out, adjusted: true, actions };
}

// Clear the cache (used by tests / after seeding new actions).
function _clearCache() { _cache.clear(); }

module.exports = { getActions, adjustCandles, ENABLED, _clearCache, SEED };
