// src/portfolio/corpActionAdjuster.js
// ─────────────────────────────────────────────────────────────────────────────
// Re-bases PAPER trade rows for splits/bonuses.
//
// Why here and not in simulationEngine: paper positions are DERIVED from the
// sim_trades table —
//     qty        = Σ(BUY qty) − Σ(SELL qty)
//     entryPrice = Σ(BUY value) / Σ(BUY qty)
// An earlier attempt adjusted simulationEngine's in-memory portfolio, which the
// UI never reads, so RELIANCE kept showing a phantom −50% (pre-bonus entry
// ₹2,606 against post-bonus price ₹1,292). To actually fix the number we must
// adjust the underlying BUY rows.
//
// For a price factor f (1:1 bonus → f = 0.5), on every BUY executed BEFORE the
// ex-date:   price × f,   qty ÷ f,   value UNCHANGED.
// Because entryPrice is value/qty, the average cost halves and the share count
// doubles — position value is preserved, which is exactly what a bonus does.
//
// Idempotent: each (portfolio, symbol, ex_date) is recorded in system_flags and
// never applied twice.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

const flagKey = (portfolioId, symbol, exDate) => `corpadj.${portfolioId}.${symbol}.${exDate}`;

async function _alreadyApplied(key) {
  try {
    const [rows] = await db.query('SELECT flag_value FROM system_flags WHERE flag_key = ? LIMIT 1', [key]);
    return !!rows?.[0];
  } catch { return false; }   // table missing → treat as not applied
}

async function _markApplied(key) {
  try {
    await db.query(
      `INSERT INTO system_flags (flag_key, flag_value, updated_at) VALUES (?, 'applied', CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE flag_value = 'applied', updated_at = CURRENT_TIMESTAMP`, [key]);
  } catch (e) { logger.debug(`[CorpAdj] mark: ${e.message}`); }
}

/**
 * Adjust one symbol's pre-ex-date BUY rows by `factor`.
 * @returns {Promise<number>} rows changed
 */
async function adjustSymbol(portfolioId, symbol, factor, exDate) {
  if (!(factor > 0) || factor === 1) return 0;
  const key = flagKey(portfolioId, symbol, exDate);
  if (await _alreadyApplied(key)) return 0;

  try {
    // value is left untouched on purpose: qty×price is invariant across a
    // bonus/split, and entryPrice is recomputed as value/qty.
    const [res] = await db.query(
      `UPDATE sim_trades
          SET qty   = GREATEST(1, ROUND(qty / ?)),
              price = price * ?
        WHERE portfolio_id = ? AND symbol = ? AND action = 'BUY'
          AND DATE(executed_at) < ?`,
      [factor, factor, portfolioId, String(symbol).toUpperCase(), exDate]
    );
    const changed = res?.affectedRows ?? 0;
    if (changed > 0) {
      await _markApplied(key);
      logger.info(`[CorpAdj] ${symbol}: adjusted ${changed} BUY row(s) for ${exDate} (factor ${factor})`);
    }
    return changed;
  } catch (e) {
    logger.warn(`[CorpAdj] ${symbol} ${exDate}: ${e.message}`);
    return 0;
  }
}

/**
 * Adjust every open paper position of a portfolio for any corporate action whose
 * ex-date falls after the position's first BUY. Safe to call on every read.
 * @returns {Promise<{adjusted:number, symbols:string[]}>}
 */
async function adjustPortfolio(portfolioId, symbols = null) {
  if (!portfolioId) return { adjusted: 0, symbols: [] };
  let corp;
  try { corp = require('../data/corporateActions'); } catch { return { adjusted: 0, symbols: [] }; }

  // Which symbols do we actually hold (or were asked about)?
  let list = symbols;
  if (!list) {
    try {
      const [rows] = await db.query(
        `SELECT symbol FROM sim_trades WHERE portfolio_id = ? GROUP BY symbol
          HAVING SUM(CASE WHEN action='BUY' THEN qty ELSE -qty END) > 0`, [portfolioId]);
      list = (rows || []).map(r => r.symbol);
    } catch { return { adjusted: 0, symbols: [] }; }
  }

  let adjusted = 0; const touched = [];
  for (const symbol of list) {
    let actions = [];
    try { actions = await corp.getActions(symbol); } catch { continue; }
    for (const a of actions) {
      const n = await adjustSymbol(portfolioId, symbol, Number(a.factor), a.ex_date);
      if (n > 0) { adjusted += n; if (!touched.includes(symbol)) touched.push(symbol); }
    }
  }
  return { adjusted, symbols: touched };
}

module.exports = { adjustPortfolio, adjustSymbol };
