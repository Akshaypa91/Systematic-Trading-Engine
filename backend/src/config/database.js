// src/config/database.js
// Production-grade MySQL connection pool with health checks and graceful shutdown

'use strict';

const mysql = require('mysql2/promise');
const logger = require('./logger');

// ─── Pool singleton ───────────────────────────────────────────────────────────
let pool = null;

/**
 * Creates and returns a MySQL connection pool.
 * Uses lazy initialization — pool is only created once.
 */
function getPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host:              process.env.DB_HOST     || 'localhost',
    port:              parseInt(process.env.DB_PORT || '3306', 10),
    user:              process.env.DB_USER     || 'root',
    password:          process.env.DB_PASSWORD || '',
    database:          process.env.DB_NAME     || 'trading_engine',
    waitForConnections: true,
    connectionLimit:   parseInt(process.env.DB_POOL_MAX || '10', 10),
    queueLimit:        0,
    connectTimeout:    parseInt(process.env.DB_ACQUIRE_TIMEOUT || '30000', 10),
    timezone:          '+05:30',   // IST — critical for NSE timestamp alignment
    charset:           'utf8mb4',
    multipleStatements: false,     // Security: prevent SQL injection via stacked queries
  });

  pool.on('connection', (conn) => {
    logger.debug(`[DB] New connection acquired (threadId: ${conn.threadId})`);
  });

  pool.on('enqueue', () => {
    logger.warn('[DB] All connections busy — request queued');
  });

  logger.info('[DB] Connection pool initialized');
  return pool;
}

/**
 * Runs a health-check query against the pool.
 * Call this on app startup to fail fast if DB is unreachable.
 */
async function testConnection() {
  const conn = await getPool().getConnection();
  try {
    const [rows] = await conn.query('SELECT 1 AS ok');
    if (rows[0].ok !== 1) throw new Error('Unexpected health-check result');
    logger.info('[DB] Health check passed');
    return true;
  } finally {
    conn.release();
  }
}

/**
 * Execute a parameterised query and return [rows, fields].
 * All callers should use this instead of raw pool.query() for
 * consistent error logging and query timing.
 *
 * @param {string}  sql    - Parameterised SQL string
 * @param {Array}   params - Bound parameters
 * @returns {Promise<[Array, Array]>}
 */
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const [rows, fields] = await getPool().execute(sql, params);
    const ms = Date.now() - start;
    if (ms > 1000) logger.warn(`[DB] Slow query (${ms}ms): ${sql.slice(0, 120)}`);
    return [rows, fields];
  } catch (err) {
    logger.error(`[DB] Query error: ${err.message} | SQL: ${sql.slice(0, 120)}`);
    throw err;
  }
}

/**
 * Execute multiple statements inside a single transaction.
 * Rolls back automatically on any error.
 *
 * @param {Function} callback - async (conn) => { ... }
 */
async function transaction(callback) {
  const conn = await getPool().getConnection();
  await conn.beginTransaction();
  try {
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    logger.error(`[DB] Transaction rolled back: ${err.message}`);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Gracefully drain the pool before process exit.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('[DB] Connection pool closed');
  }
}

// NOTE: Shutdown signals are handled by app.js which calls closePool() before exit.
// Do NOT register SIGINT/SIGTERM here — it causes duplicate handlers and double-exit.

module.exports = { getPool, testConnection, query, transaction, closePool };
