-- ─────────────────────────────────────────────────────────────────────────────
-- Persistent Portfolio Migration
-- Run: node scripts/migrate.js  OR  mysql < scripts/migrate-portfolio.sql
-- Safe to re-run — all statements use IF NOT EXISTS / IF EXISTS guards
-- ─────────────────────────────────────────────────────────────────────────────

USE trading_engine;

-- ─── 1. portfolios ────────────────────────────────────────────────────────────
-- One row per user session.  user_id = NULL means the single anonymous portfolio.
-- Tracks starting capital, current available cash, and lifecycle state.
CREATE TABLE IF NOT EXISTS portfolios (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED                        DEFAULT NULL,  -- FK to users(id), NULL = anon
  initial_capital DECIMAL(16,2)  NOT NULL,
  current_capital DECIMAL(16,2)  NOT NULL,
  status          ENUM('ACTIVE','RESET','CLOSED')     NOT NULL DEFAULT 'ACTIVE',
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_user_id   (user_id),
  INDEX idx_status    (status),
  INDEX idx_created   (created_at DESC)
) ENGINE=InnoDB;

-- ─── 2. sim_trades ────────────────────────────────────────────────────────────
-- Every BUY / SELL executed in the simulation portfolio.
-- Positions are RECONSTRUCTED from this ledger — no separate positions table
-- to avoid synchronisation bugs (the ledger IS the truth).
CREATE TABLE IF NOT EXISTS sim_trades (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  portfolio_id BIGINT UNSIGNED NOT NULL,
  symbol       VARCHAR(20)    NOT NULL,
  action       ENUM('BUY','SELL') NOT NULL,
  qty          INT UNSIGNED   NOT NULL,
  price        DECIMAL(12,4)  NOT NULL,
  value        DECIMAL(16,4)  NOT NULL  COMMENT 'qty * price',
  pnl          DECIMAL(14,4)  DEFAULT NULL COMMENT 'realised P&L for SELL trades',
  price_source ENUM('API','SIM','MANUAL') NOT NULL DEFAULT 'SIM',
  executed_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY fk_portfolio (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,

  INDEX idx_portfolio_symbol  (portfolio_id, symbol),
  INDEX idx_portfolio_ts      (portfolio_id, executed_at DESC),
  INDEX idx_symbol            (symbol),
  INDEX idx_executed_at       (executed_at DESC)
) ENGINE=InnoDB;

-- ─── 3. Ensure existing tables have no conflicts ──────────────────────────────
-- (nothing to drop — we add new tables only)