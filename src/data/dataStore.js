// src/data/dataStore.js
// Persists market data to MySQL and provides clean read APIs for strategy modules.

'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Upserts an array of OHLCV rows into daily_prices.
 * Uses INSERT … ON DUPLICATE KEY UPDATE for idempotency — safe to re-run.
 *
 * @param {Array<Object>} rows - Normalised rows from nseFetcher
 * @returns {Promise<number>} Rows affected
 */
async function saveDailyPrices(rows) {
  if (!rows || rows.length === 0) return 0;

  // Build a single multi-row INSERT for performance
  const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  const values = rows.flatMap(r => [
    r.symbol,
    r.exchange || 'NSE',
    r.date,
    r.open,
    r.high,
    r.low,
    r.close,
    r.vwap     || null,
    r.volume   || 0,
    r.deliveryQty || null,
    r.deliveryPct || null,
    r.trades   || null,
  ]);

  const sql = `
    INSERT INTO daily_prices
      (symbol, exchange, trade_date, open_price, high_price, low_price,
       close_price, vwap, volume, delivery_qty, delivery_pct, num_trades)
    VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      open_price   = VALUES(open_price),
      high_price   = VALUES(high_price),
      low_price    = VALUES(low_price),
      close_price  = VALUES(close_price),
      vwap         = VALUES(vwap),
      volume       = VALUES(volume),
      delivery_qty = VALUES(delivery_qty),
      delivery_pct = VALUES(delivery_pct),
      num_trades   = VALUES(num_trades)
  `;

  const [result] = await db.query(sql, values);
  logger.info(`[DataStore] Upserted ${result.affectedRows} price rows for ${rows[0]?.symbol}`);
  return result.affectedRows;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch daily OHLCV rows for a symbol, sorted ascending.
 *
 * @param {string}  symbol
 * @param {number}  limit  - Max rows (most recent). 0 = all.
 * @param {string}  startDate - Optional ISO date string 'YYYY-MM-DD'
 * @param {string}  endDate   - Optional ISO date string 'YYYY-MM-DD'
 * @returns {Promise<Array<Object>>}
 */
async function getDailyPrices(symbol, { limit = 0, startDate = null, endDate = null } = {}) {
  let sql = `
    SELECT
      symbol, exchange, trade_date AS date,
      open_price AS open, high_price AS high, low_price AS low,
      close_price AS close, vwap, volume, delivery_qty, delivery_pct, num_trades
    FROM daily_prices
    WHERE symbol = ?
  `;
  const params = [symbol];

  if (startDate) { sql += ' AND trade_date >= ?'; params.push(startDate); }
  if (endDate)   { sql += ' AND trade_date <= ?'; params.push(endDate);   }

  sql += ' ORDER BY trade_date ASC';
  // Safe LIMIT via parameterised query — no string interpolation
  if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const [rows] = await db.query(sql, params);
  return rows.map(normaliseRow);
}

/**
 * Fetch close prices only — lightweight call for indicator computation.
 * @returns {Promise<Array<{ date: string, close: number }>>}
 */
async function getClosePrices(symbol, limit = 0) {
  let sql = `
    SELECT trade_date AS date, close_price AS close
    FROM daily_prices
    WHERE symbol = ?
    ORDER BY trade_date ASC
  `;
  if (limit > 0) {
    sql = `SELECT * FROM (${sql} LIMIT ${limit}) t ORDER BY date ASC`;
  }
  const params = [symbol];
  if (limit > 0) { sql += ' LIMIT ?'; params.push(limit); }
  const [rows] = await db.query(sql, params);
  return rows.map(r => ({ date: r.date, close: parseFloat(r.close) }));
}

/**
 * Returns the most recent N rows for a symbol.
 */
async function getRecentPrices(symbol, n = 200) {
  const sql = `
    SELECT
      symbol, trade_date AS date,
      open_price AS open, high_price AS high, low_price AS low,
      close_price AS close, vwap, volume
    FROM daily_prices
    WHERE symbol = ?
    ORDER BY trade_date DESC
    LIMIT ?
  `;
  const [rows] = await db.query(sql, [symbol, n]);
  // Return ascending so strategies can process chronologically
  return rows.map(normaliseRow).reverse();
}

/**
 * Check whether sufficient history exists for a symbol.
 * @returns {Promise<{ count: number, earliest: string, latest: string }>}
 */
async function getPriceStats(symbol) {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS cnt,
           MIN(trade_date) AS earliest,
           MAX(trade_date) AS latest
    FROM daily_prices
    WHERE symbol = ?
  `, [symbol]);
  return {
    count:    rows[0].cnt,
    earliest: rows[0].earliest,
    latest:   rows[0].latest,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseRow(r) {
  return {
    symbol: r.symbol,
    date:   r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    open:   parseFloat(r.open),
    high:   parseFloat(r.high),
    low:    parseFloat(r.low),
    close:  parseFloat(r.close),
    vwap:   r.vwap   ? parseFloat(r.vwap)   : null,
    volume: r.volume ? parseInt(r.volume, 10): 0,
  };
}

module.exports = {
  saveDailyPrices,
  getDailyPrices,
  getClosePrices,
  getRecentPrices,
  getPriceStats,
};
