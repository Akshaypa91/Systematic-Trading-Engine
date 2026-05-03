// src/config/initDB.js
// ─────────────────────────────────────────────────────────────────────────────
//
// DATABASE INITIALISER
// ─────────────────────────────────────────────────────────────────────────────
//
// Runs every table's CREATE TABLE IF NOT EXISTS on server startup.
// Safe to call multiple times — never drops or modifies existing data.
//
// TABLES CREATED (if not present):
//   1.  users                — auth
//   2.  daily_prices         — OHLCV history
//   3.  signals              — signal log
//   4.  backtest_runs        — backtest results
//   5.  backtest_trades      — backtest trade log
//   6.  paper_trades         — execution engine trades
//   7.  portfolio            — legacy portfolio positions
//   8.  performance_metrics  — daily equity snapshots
//   9.  data_fetch_log       — API fetch audit
//   10. system_health        — health check log
//   11. portfolios           — sim portfolio sessions   ← the failing table
//   12. sim_trades           — sim trade ledger         ← the failing table
//
// Called in app.js start() immediately after db.testConnection().
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const db     = require('./database');
const logger = require('./logger');

// ── DDL statements ────────────────────────────────────────────────────────────
// Written as individual strings so a failure in one table is logged clearly
// without aborting creation of the others.

const TABLES = [

  // ── 1. users ───────────────────────────────────────────────────────────────
  {
    name: 'users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email      VARCHAR(255) NOT NULL UNIQUE,
        password   VARCHAR(512) NOT NULL,
        role       ENUM('admin','user') NOT NULL DEFAULT 'user',
        is_active  TINYINT(1) NOT NULL DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 2. daily_prices ────────────────────────────────────────────────────────
  {
    name: 'daily_prices',
    sql: `
      CREATE TABLE IF NOT EXISTS daily_prices (
        id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        symbol       VARCHAR(20)   NOT NULL,
        exchange     ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
        trade_date   DATE          NOT NULL,
        open_price   DECIMAL(12,4) NOT NULL,
        high_price   DECIMAL(12,4) NOT NULL,
        low_price    DECIMAL(12,4) NOT NULL,
        close_price  DECIMAL(12,4) NOT NULL,
        vwap         DECIMAL(12,4),
        volume       BIGINT UNSIGNED DEFAULT 0,
        delivery_qty BIGINT UNSIGNED DEFAULT 0,
        delivery_pct DECIMAL(6,2),
        num_trades   INT UNSIGNED,
        prev_close   DECIMAL(12,4),
        change_pct   DECIMAL(8,4),
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_symbol_date (symbol, exchange, trade_date),
        INDEX idx_symbol            (symbol),
        INDEX idx_trade_date        (trade_date),
        INDEX idx_symbol_date_close (symbol, trade_date, close_price)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 3. signals ─────────────────────────────────────────────────────────────
  {
    name: 'signals',
    sql: `
      CREATE TABLE IF NOT EXISTS signals (
        id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        symbol          VARCHAR(20)  NOT NULL,
        signal_type     ENUM('BUY','SELL','HOLD') NOT NULL,
        strategy        VARCHAR(60)  NOT NULL,
        confidence      DECIMAL(5,4),
        price_at_signal DECIMAL(12,4),
        z_score         DECIMAL(10,6),
        rsi_value       DECIMAL(8,4),
        ma_fast         DECIMAL(12,4),
        ma_slow         DECIMAL(12,4),
        regime          VARCHAR(20),
        metadata        JSON,
        signal_ts       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_symbol_ts   (symbol, signal_ts),
        INDEX idx_strategy    (strategy),
        INDEX idx_signal_type (signal_type),
        INDEX idx_ts_desc     (signal_ts DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 4. backtest_runs ───────────────────────────────────────────────────────
  {
    name: 'backtest_runs',
    sql: `
      CREATE TABLE IF NOT EXISTS backtest_runs (
        id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        run_name              VARCHAR(120),
        symbol                VARCHAR(20)  NOT NULL,
        strategy              VARCHAR(60)  NOT NULL,
        start_date            DATE NOT NULL,
        end_date              DATE NOT NULL,
        initial_capital       DECIMAL(14,2) NOT NULL,
        final_capital         DECIMAL(14,2),
        total_return_pct      DECIMAL(10,4),
        annualised_return_pct DECIMAL(10,4),
        sharpe_ratio          DECIMAL(8,4),
        sortino_ratio         DECIMAL(8,4),
        max_drawdown_pct      DECIMAL(8,4),
        win_rate_pct          DECIMAL(8,4),
        total_trades          INT UNSIGNED DEFAULT 0,
        winning_trades        INT UNSIGNED DEFAULT 0,
        losing_trades         INT UNSIGNED DEFAULT 0,
        parameters            JSON,
        created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_symbol_strategy (symbol, strategy),
        INDEX idx_created_at      (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 5. backtest_trades ─────────────────────────────────────────────────────
  {
    name: 'backtest_trades',
    sql: `
      CREATE TABLE IF NOT EXISTS backtest_trades (
        id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        run_id      BIGINT UNSIGNED NOT NULL,
        symbol      VARCHAR(20) NOT NULL,
        side        ENUM('BUY','SELL') NOT NULL,
        entry_date  DATE NOT NULL,
        entry_price DECIMAL(12,4) NOT NULL,
        exit_date   DATE,
        exit_price  DECIMAL(12,4),
        quantity    INT UNSIGNED NOT NULL,
        pnl         DECIMAL(14,4),
        pnl_pct     DECIMAL(8,4),
        commission  DECIMAL(12,4) DEFAULT 0,
        exit_reason ENUM('SIGNAL','STOP_LOSS','TAKE_PROFIT','END_OF_DATA') DEFAULT 'SIGNAL',
        FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
        INDEX idx_run_id (run_id),
        INDEX idx_symbol (symbol)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 6. paper_trades ────────────────────────────────────────────────────────
  {
    name: 'paper_trades',
    sql: `
      CREATE TABLE IF NOT EXISTS paper_trades (
        id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id          VARCHAR(40)  NOT NULL UNIQUE,
        symbol            VARCHAR(20)  NOT NULL,
        exchange          ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
        order_type        ENUM('MARKET','LIMIT','SL','SL-M') NOT NULL DEFAULT 'MARKET',
        side              ENUM('BUY','SELL') NOT NULL,
        quantity          INT UNSIGNED NOT NULL,
        limit_price       DECIMAL(12,4),
        executed_price    DECIMAL(12,4),
        status            ENUM('PENDING','EXECUTED','CANCELLED','REJECTED') NOT NULL DEFAULT 'PENDING',
        strategy          VARCHAR(60),
        pnl               DECIMAL(14,4),
        commission        DECIMAL(12,4) DEFAULT 0,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        executed_at       DATETIME,
        INDEX idx_symbol_status (symbol, status),
        INDEX idx_created_at    (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 7. portfolio (legacy positions table) ─────────────────────────────────
  {
    name: 'portfolio',
    sql: `
      CREATE TABLE IF NOT EXISTS portfolio (
        id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        symbol         VARCHAR(20)  NOT NULL,
        exchange       ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
        quantity       INT NOT NULL DEFAULT 0,
        avg_cost       DECIMAL(12,4),
        current_price  DECIMAL(12,4),
        market_value   DECIMAL(14,4),
        unrealised_pnl DECIMAL(14,4),
        realised_pnl   DECIMAL(14,4) DEFAULT 0,
        last_updated   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_symbol (symbol, exchange)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 8. performance_metrics ─────────────────────────────────────────────────
  {
    name: 'performance_metrics',
    sql: `
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        metric_date    DATE NOT NULL,
        total_equity   DECIMAL(14,2) NOT NULL,
        cash           DECIMAL(14,2),
        market_value   DECIMAL(14,2),
        daily_pnl      DECIMAL(14,4),
        daily_return   DECIMAL(10,6),
        total_return   DECIMAL(10,6),
        drawdown       DECIMAL(10,6),
        open_positions INT UNSIGNED DEFAULT 0,
        trades_today   INT UNSIGNED DEFAULT 0,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_date (metric_date),
        INDEX idx_metric_date (metric_date DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 9. data_fetch_log ──────────────────────────────────────────────────────
  {
    name: 'data_fetch_log',
    sql: `
      CREATE TABLE IF NOT EXISTS data_fetch_log (
        id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        symbol      VARCHAR(20),
        source      VARCHAR(40) NOT NULL,
        fetch_date  DATE,
        rows_saved  INT UNSIGNED DEFAULT 0,
        status      ENUM('SUCCESS','PARTIAL','FAILED') NOT NULL,
        error_msg   TEXT,
        duration_ms INT UNSIGNED,
        fetched_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_symbol_date (symbol, fetched_at),
        INDEX idx_status      (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 10. system_health ──────────────────────────────────────────────────────
  {
    name: 'system_health',
    sql: `
      CREATE TABLE IF NOT EXISTS system_health (
        id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        db_status  ENUM('ok','error') NOT NULL DEFAULT 'ok',
        heap_mb    INT UNSIGNED,
        uptime_s   INT UNSIGNED,
        open_pos   INT UNSIGNED DEFAULT 0,
        error_msg  TEXT,
        INDEX idx_checked_at (checked_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  // ── 11. portfolios ─────────────────────────────────────────────────────────
  // Sim portfolio sessions. One row per user session.
  // Capital is stored here; positions reconstructed from sim_trades ledger.
  {
    name: 'portfolios',
    sql: `
      CREATE TABLE IF NOT EXISTS portfolios (
        id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id         INT UNSIGNED DEFAULT NULL,
        initial_capital DECIMAL(16,2) NOT NULL,
        current_capital DECIMAL(16,2) NOT NULL,
        status          ENUM('ACTIVE','RESET','CLOSED') NOT NULL DEFAULT 'ACTIVE',
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status  (status),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

  
  // ── password_resets ──────────────────────────────────────────────────────────
  {
    name: 'password_resets',
    sql: `
      CREATE TABLE IF NOT EXISTS password_resets (
        user_id    INT UNSIGNED NOT NULL PRIMARY KEY,
        token      VARCHAR(64)  NOT NULL,
        expires_at DATETIME     NOT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_token (token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
  },
  // ── feedback ────────────────────────────────────────────────────────────────
  {
    name: 'feedback',
    sql: `
      CREATE TABLE IF NOT EXISTS feedback (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id    INT UNSIGNED NULL,
        name       VARCHAR(100) NULL,
        email      VARCHAR(255) NULL,
        type       VARCHAR(50)  NOT NULL DEFAULT 'general',
        message    TEXT         NOT NULL,
        rating     TINYINT      NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_type    (type),
        INDEX idx_created (created_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
  },
  // ── 12. sim_trades ─────────────────────────────────────────────────────────
  // Append-only trade ledger. Positions reconstructed by GROUP BY query.
  // FK to portfolios ensures referential integrity.
  {
    name: 'sim_trades',
    sql: `
      CREATE TABLE IF NOT EXISTS sim_trades (
        id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        portfolio_id BIGINT UNSIGNED NOT NULL,
        symbol       VARCHAR(20)    NOT NULL,
        action       ENUM('BUY','SELL') NOT NULL,
        qty          INT UNSIGNED   NOT NULL,
        price        DECIMAL(12,4)  NOT NULL,
        value        DECIMAL(16,4)  NOT NULL,
        pnl          DECIMAL(14,4)  DEFAULT NULL,
        price_source ENUM('API','SIM','MANUAL') NOT NULL DEFAULT 'SIM',
        executed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY fk_sim_portfolio (portfolio_id)
          REFERENCES portfolios(id) ON DELETE CASCADE,
        INDEX idx_portfolio_symbol (portfolio_id, symbol),
        INDEX idx_portfolio_ts     (portfolio_id, executed_at DESC),
        INDEX idx_executed_at      (executed_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  },

];

// ── initDB ────────────────────────────────────────────────────────────────────

/**
 * Create all tables if they don't exist.
 * Called once at startup after db.testConnection() passes.
 *
 * - Each table is attempted independently — one failure doesn't block others
 * - Uses IF NOT EXISTS — safe to call on every deploy/restart
 * - Logs each table: ✅ created / ✅ exists / ❌ error
 *
 * @returns {Promise<{ created: string[], existing: string[], failed: string[] }>}
 */
async function initDB() {
  logger.info('[InitDB] Running table initialisation…');

  const results = { created: [], existing: [], failed: [] };

  for (const { name, sql } of TABLES) {
    try {
      // Check if table already exists — avoid misleading "created" log
      const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [name]
      );

      const existed = rows[0].cnt > 0;

      // Run DDL regardless — IF NOT EXISTS makes it a no-op if table is there
      await db.query(sql.trim());

      if (existed) {
        results.existing.push(name);
        logger.debug(`[InitDB] ✅ exists   — ${name}`);
      } else {
        results.created.push(name);
        logger.info(`[InitDB] ✅ created  — ${name}`);
      }
    } catch (err) {
      results.failed.push(name);
      logger.error(`[InitDB] ❌ failed   — ${name}: ${err.message}`);
      // Non-fatal: log and continue with remaining tables
    }
  }

  const { created, existing, failed } = results;
  logger.info(
    `[InitDB] Done — ${created.length} created, ${existing.length} existed, ${failed.length} failed` +
    (failed.length ? ` (${failed.join(', ')})` : '')
  );

  return results;
}

module.exports = { initDB };
