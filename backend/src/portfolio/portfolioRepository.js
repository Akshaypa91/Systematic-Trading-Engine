// src/portfolio/portfolioRepository.js
// ─────────────────────────────────────────────────────────────────────────────
//
// PORTFOLIO REPOSITORY
// ─────────────────────────────────────────────────────────────────────────────
//
// All PostgreSQL/CockroachDB I/O for portfolio persistence.
// Zero business logic here — pure data access layer.
//
// TABLES USED
// ───────────
//   portfolios  — one row = one session; stores capital balance
//   sim_trades  — append-only ledger of every BUY/SELL executed
//
// POSITION RECONSTRUCTION
// ───────────────────────
// Positions are derived from the trade ledger, never stored separately:
//
//   SELECT symbol,
//          SUM(CASE WHEN action='BUY'  THEN qty ELSE -qty END) AS net_qty,
//          SUM(CASE WHEN action='BUY'  THEN qty*price ELSE 0 END) /
//          NULLIF(SUM(CASE WHEN action='BUY' THEN qty ELSE 0 END),0) AS avg_cost
//   FROM sim_trades
//   WHERE portfolio_id = ?
//   GROUP BY symbol
//   HAVING net_qty > 0
//
// This ensures the DB is always the single source of truth.
// No synchronisation bugs between a positions table and a trades table.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const db = require('../config/database');
const logger = require('../config/logger');

// ── Portfolio CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new portfolio row with the given starting capital.
 * Marks any previous ACTIVE portfolio for this user_id as CLOSED first.
 *
 * @param {number}       capital
 * @param {number|null}  userId   null = anonymous single-user mode
 * @returns {Promise<number>}     New portfolio ID
 */
async function createPortfolio(capital, userId = null) {
  return db.transaction(async (conn) => {
    // Close any existing active portfolio for this user
    await conn.query(
      `UPDATE portfolios
   SET status = 'CLOSED', updated_at = CURRENT_TIMESTAMP
   WHERE status = 'ACTIVE'
     AND user_id IS NOT DISTINCT FROM ?`,
      [userId]
    );

    // Insert new portfolio
    const [rows] = await conn.query(
      `INSERT INTO portfolios
   (user_id, initial_capital, current_capital, status)
   VALUES (?, ?, ?, 'ACTIVE')
   RETURNING id`,
      [userId, capital, capital]
    );

    const portfolioId = rows[0].id;
    logger.info(`[PortfolioRepo] Created portfolio #${portfolioId} capital=₹${capital}`);
    return portfolioId;
  });
}

/**
 * Load the most recent ACTIVE portfolio.
 *
 * @param {number|null} userId
 * @returns {Promise<{id, initial_capital, current_capital, status, created_at}|null>}
 */
async function getActivePortfolio(userId = null) {
  // Strict nullable equality: user_id = NULL never works in SQL.
  const [rows] = await db.query(
    `SELECT id, user_id, initial_capital, current_capital, status, created_at, updated_at
     FROM portfolios
     WHERE status = 'ACTIVE'
       AND user_id IS NOT DISTINCT FROM ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    initial_capital: parseFloat(r.initial_capital) || 0,
    current_capital: parseFloat(r.current_capital) || 0,
  };
}

/**
 * Update the current_capital of a portfolio.
 *
 * @param {number} portfolioId
 * @param {number} capital
 */
async function updateCapital(portfolioId, capital) {
  await db.query(
    `UPDATE portfolios SET current_capital = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [parseFloat(capital.toFixed(2)), portfolioId]
  );
}

/**
 * Mark a portfolio as RESET: restore capital to initial, delete its trades.
 * Uses a transaction so trades + capital update are atomic.
 *
 * @param {number} portfolioId
 * @returns {Promise<number>} The restored initial_capital
 */
async function resetPortfolio(portfolioId) {
  return db.transaction(async (conn) => {
    // Read initial capital
    const [rows] = await conn.query(
      'SELECT initial_capital FROM portfolios WHERE id = ?',
      [portfolioId]
    );
    if (!rows[0]) throw new Error(`Portfolio #${portfolioId} not found`);
    const initialCapital = parseFloat(rows[0].initial_capital);

    // Delete all trades for this portfolio
    await conn.query('DELETE FROM sim_trades WHERE portfolio_id = ?', [portfolioId]);

    // Restore capital
    await conn.query(
      `UPDATE portfolios SET current_capital = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [initialCapital, portfolioId]
    );

    logger.info(`[PortfolioRepo] Portfolio #${portfolioId} reset to ₹${initialCapital}`);
    return initialCapital;
  });
}

// ── Trade persistence ─────────────────────────────────────────────────────────

/**
 * Insert a trade and update portfolio capital atomically.
 *
 * Capital update rules:
 *   BUY:  capital -= qty * price
 *   SELL: capital += qty * price
 *
 * @param {{
 *   portfolioId: number,
 *   symbol:      string,
 *   action:      'BUY'|'SELL',
 *   qty:         number,
 *   price:       number,
 *   pnl?:        number|null,
 *   priceSource?: 'API'|'SIM'|'MANUAL',
 * }} trade
 * @returns {Promise<{tradeId: number, newCapital: number, trade: object}>}
 */
async function saveTrade(trade) {
  const {
    portfolioId,
    symbol,
    action,
    qty,
    price,
    pnl = null,
    priceSource = 'SIM',
  } = trade;

  // Normalize any source string into the price_source CHECK constraint.
  // LIVE_UPSTOX / LIVE_NSE / LIVE_TWELVE / LIVE_FINNHUB → 'API'
  // SIM / SIMULATION → 'SIM'
  // MANUAL / USER → 'MANUAL'
  function _normalizeSource(src) {
    const s = (src || '').toUpperCase();
    if (s.startsWith('LIVE') || s === 'API' || s === 'UPSTOX' ||
      s === 'NSE' || s === 'TWELVE' || s === 'FINNHUB' || s === 'YAHOO_FINANCE') return 'API';
    if (s === 'MANUAL' || s === 'USER') return 'MANUAL';
    return 'SIM';
  }
  const safeSource = _normalizeSource(priceSource);

  const value = parseFloat((qty * price).toFixed(4));

  return db.transaction(async (conn) => {
    // 1. Lock portfolio row
    const [pfRows] = await conn.query(
      'SELECT current_capital FROM portfolios WHERE id = ? FOR UPDATE',
      [portfolioId]
    );
    if (!pfRows[0]) throw new Error(`Portfolio #${portfolioId} not found`);

    const prevCapital = parseFloat(pfRows[0].current_capital);
    const newCapital = action === 'BUY'
      ? parseFloat((prevCapital - value).toFixed(2))
      : parseFloat((prevCapital + value).toFixed(2));

    if (action === 'BUY' && newCapital < 0) {
      throw Object.assign(
        new Error(`Insufficient capital. Need ₹${value.toFixed(2)}, have ₹${prevCapital.toFixed(2)}`),
        { statusCode: 400 }
      );
    }

    // 2. Insert trade
    const [tradeRows] = await conn.query(
      `INSERT INTO sim_trades
         (portfolio_id, symbol, action, qty, price, value, pnl, price_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, executed_at`,
      [portfolioId, symbol.toUpperCase(), action, qty,
        parseFloat(price.toFixed(4)), value,
        pnl !== null ? parseFloat(pnl.toFixed(4)) : null,
        safeSource]
    );
    const savedId = tradeRows[0].id;
    const executedAt = tradeRows[0].executed_at;

    // 3. Update capital
    await conn.query(
      'UPDATE portfolios SET current_capital = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newCapital, portfolioId]
    );

    const savedTrade = {
      id: savedId,
      portfolioId,
      symbol: symbol.toUpperCase(),
      action,
      qty,
      price: parseFloat(price.toFixed(2)),
      value: parseFloat(value.toFixed(2)),
      pnl: pnl !== null ? parseFloat(pnl.toFixed(2)) : null,
      priceSource,
      executedAt: executedAt instanceof Date ? executedAt.toISOString() : String(executedAt),
    };

    logger.info(
      `[PortfolioRepo] Trade #${savedId}: ${action} ${qty}×${symbol} ` +
      `@₹${price.toFixed(2)} | capital ₹${prevCapital}→₹${newCapital}`
    );

    return { tradeId: savedId, newCapital, trade: savedTrade };
  });
}

// ── Position reconstruction ───────────────────────────────────────────────────

/**
 * Reconstruct open positions from the trade ledger.
 *
 * Algorithm (pure SQL):
 *   net_qty  = SUM(BUY qty) - SUM(SELL qty)
 *   avg_cost = total_buy_value / total_buy_qty  (FIFO-approximate, adequate for sim)
 *
 * Returns only symbols where net_qty > 0.
 *
 * @param {number} portfolioId
 * @returns {Promise<{[symbol]: {qty, entryPrice, totalCost}}>}
 */
async function getPositions(portfolioId) {
  const [rows] = await db.query(
    `SELECT
       symbol,
       SUM(CASE WHEN action = 'BUY'  THEN qty  ELSE -qty  END) AS net_qty,
       SUM(CASE WHEN action = 'BUY'  THEN value ELSE 0    END) AS total_buy_value,
       SUM(CASE WHEN action = 'BUY'  THEN qty  ELSE 0    END) AS total_buy_qty,
       SUM(CASE WHEN action = 'SELL' THEN COALESCE(pnl,0) ELSE 0 END) AS realised_pnl
     FROM sim_trades
     WHERE portfolio_id = ?
     GROUP BY symbol
     HAVING SUM(CASE WHEN action = 'BUY' THEN qty ELSE -qty END) > 0
     ORDER BY symbol`,
    [portfolioId]
  );

  const positions = {};
  for (const row of rows) {
    // pg returns DECIMAL/SUM fields as strings — coerce all to numbers first.
    const netQty = parseInt(row.net_qty, 10);
    const totalBuyValue = parseFloat(row.total_buy_value) || 0;
    const totalBuyQty = parseFloat(row.total_buy_qty) || 0;
    const realisedPnl = parseFloat(row.realised_pnl) || 0;

    const avgCost = totalBuyQty > 0
      ? parseFloat((totalBuyValue / totalBuyQty).toFixed(4))
      : 0;

    positions[row.symbol] = {
      qty: netQty,
      entryPrice: parseFloat(avgCost.toFixed(2)),
      totalCost: parseFloat(totalBuyValue.toFixed(2)),
      realisedPnl: parseFloat(realisedPnl.toFixed(2)),
    };
  }

  return positions;
}

/**
 * Get a single symbol's open position.
 *
 * @param {number} portfolioId
 * @param {string} symbol
 * @returns {Promise<{qty, entryPrice, totalCost}|null>}
 */
async function getPosition(portfolioId, symbol) {
  const [rows] = await db.query(
    `SELECT
       SUM(CASE WHEN action = 'BUY'  THEN qty   ELSE -qty  END) AS net_qty,
       SUM(CASE WHEN action = 'BUY'  THEN value ELSE 0     END) AS total_buy_value,
       SUM(CASE WHEN action = 'BUY'  THEN qty   ELSE 0     END) AS total_buy_qty
     FROM sim_trades
     WHERE portfolio_id = ? AND symbol = ?
     GROUP BY symbol
     HAVING SUM(CASE WHEN action = 'BUY' THEN qty ELSE -qty END) > 0`,
    [portfolioId, symbol.toUpperCase()]
  );

  if (!rows[0] || parseInt(rows[0].net_qty, 10) <= 0) return null;

  const netQty = parseInt(rows[0].net_qty, 10);
  const totalBuyValue = parseFloat(rows[0].total_buy_value) || 0;
  const totalBuyQty = parseFloat(rows[0].total_buy_qty) || 0;

  const avgCost = totalBuyQty > 0
    ? parseFloat((totalBuyValue / totalBuyQty).toFixed(4))
    : 0;

  return {
    qty: netQty,
    entryPrice: parseFloat(avgCost.toFixed(2)),
    totalCost: parseFloat(totalBuyValue.toFixed(2)),
  };
}

// ── Trade history ─────────────────────────────────────────────────────────────

/**
 * Get recent trades for a portfolio (newest first).
 *
 * @param {number} portfolioId
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function getTrades(portfolioId, limit = 50) {
  const [rows] = await db.query(
    `SELECT id, symbol, action, qty, price, value, pnl, price_source, executed_at
     FROM sim_trades
     WHERE portfolio_id = ?
     ORDER BY executed_at DESC
     LIMIT ?`,
    [portfolioId, Math.min(limit, 200)]
  );

  return rows.map(r => ({
    id: r.id,
    symbol: r.symbol,
    action: r.action,
    qty: r.qty,
    price: parseFloat(r.price),
    value: parseFloat(r.value),
    pnl: r.pnl !== null ? parseFloat(r.pnl) : null,
    priceSource: r.price_source,
    executedAt: r.executed_at instanceof Date
      ? r.executed_at.toISOString()
      : String(r.executed_at),
  }));
}

/**
 * Aggregate realised P&L per symbol for a portfolio.
 *
 * @param {number} portfolioId
 * @returns {Promise<{symbol, realisedPnl}[]>}
 */
async function getRealisedPnlBySymbol(portfolioId) {
  const [rows] = await db.query(
    `SELECT symbol, SUM(COALESCE(pnl, 0)) AS realised_pnl
     FROM sim_trades
     WHERE portfolio_id = ? AND action = 'SELL'
     GROUP BY symbol
     ORDER BY realised_pnl DESC`,
    [portfolioId]
  );
  return rows.map(r => ({
    symbol: r.symbol,
    realisedPnl: parseFloat(r.realised_pnl),
  }));
}

module.exports = {
  // Portfolio lifecycle
  createPortfolio,
  getActivePortfolio,
  updateCapital,
  resetPortfolio,

  // Trade persistence
  saveTrade,

  // Position reconstruction
  getPositions,
  getPosition,

  // History / analytics
  getTrades,
  getRealisedPnlBySymbol,
};
