'use strict';

// TiDB Cloud connection layer (MySQL wire protocol via mysql2).
// Replaces the previous pg/CockroachDB pool. TiDB Serverless requires TLS.
//
// Config resolution order: DATABASE_URL (if set) wins; otherwise built from
// TIDB_HOST/TIDB_PORT/TIDB_USERNAME/TIDB_PASSWORD/TIDB_DATABASE. Both forms
// are supported because different deploy targets (Render/Vercel vs. TiDB's
// own docs) tend to hand you one or the other.
const fs = require('fs');
const mysql = require('mysql2/promise');
const logger = require('./logger');

function buildSSLConfig() {
  // TIDB_SSL_CA is optional: TiDB Cloud Serverless certs are publicly
  // trusted (validate against the OS trust store), so a bundled CA file
  // usually isn't required. Set TIDB_SSL_CA to a filesystem path if you
  // need to pin a specific CA bundle (e.g. TiDB Dedicated with a private CA).
  const caPath = process.env.TIDB_SSL_CA;
  const ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  if (caPath) {
    try {
      ssl.ca = fs.readFileSync(caPath, 'utf8');
    } catch (err) {
      logger.warn(`[DB] Could not read TIDB_SSL_CA at ${caPath}: ${err.message} — continuing without a pinned CA`);
    }
  }
  return ssl;
}

function poolConfig() {
  if (process.env.DATABASE_URL) {
    return { uri: process.env.DATABASE_URL, ssl: buildSSLConfig() };
  }
  return {
    host: process.env.TIDB_HOST,
    port: parseInt(process.env.TIDB_PORT || '4000', 10),
    user: process.env.TIDB_USERNAME,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE,
    ssl: buildSSLConfig(),
  };
}

const pool = mysql.createPool({
  ...poolConfig(),
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_MAX || '10', 10),
  queueLimit: 0,
  connectTimeout: 10000,
  idleTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    logger.info('[DB] TiDB Cloud connected');
    return true;
  } finally {
    conn.release();
  }
}

// Transient errors worth a retry (dropped connections, not query bugs).
const RETRYABLE_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE',
]);

/**
 * Run a query with mysql2's native `?` placeholders — no conversion needed
 * (previously this app ran against Postgres, which required rewriting `?`
 * to `$1, $2, ...`; TiDB speaks MySQL protocol, so the placeholders the
 * codebase already uses everywhere work as-is).
 *
 * Returns [rows, result] to match the shape every caller already expects
 * (mysql2 returns this natively — result.affectedRows/insertId are already
 * populated by the driver for INSERT/UPDATE/DELETE, no adapting required).
 */
async function query(sql, params = [], _attempt = 0) {
  try {
    const [rows] = await pool.query(sql, params);
    return [rows, rows];
  } catch (err) {
    if (RETRYABLE_CODES.has(err.code) && _attempt < 2) {
      const delay = 200 * Math.pow(2, _attempt);
      logger.warn(`[DB] Retryable error (${err.code}), retry ${_attempt + 1}/2 in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      return query(sql, params, _attempt + 1);
    }
    throw err;
  }
}

async function closePool() {
  await pool.end();
}

async function transaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tx = {
      query: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return [rows, rows];
      },
    };

    const result = await callback(tx);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      logger.error(`[DB] Rollback failed: ${rollbackErr.message}`);
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  pool,
  query,
  transaction,
  testConnection,
  closePool,
};
