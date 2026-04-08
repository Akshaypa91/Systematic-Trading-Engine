-- Systematic Trading Engine — Production MySQL Schema v2
-- Run: node scripts/migrate.js
-- Or: mysql -u root -p trading_engine < scripts/schema.sql

CREATE DATABASE IF NOT EXISTS trading_engine
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE trading_engine;

-- ─── 1. Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(512) NOT NULL,
  role       ENUM('admin','user') NOT NULL DEFAULT 'user',
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  last_login DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB;

-- ─── 2. Instruments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instruments (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol       VARCHAR(20)  NOT NULL,
  company_name VARCHAR(150),
  exchange     ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  series       VARCHAR(5)   DEFAULT 'EQ',
  isin         VARCHAR(12),
  sector       VARCHAR(80),
  industry     VARCHAR(80),
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_exchange (symbol, exchange),
  INDEX idx_sector (sector),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- ─── 3. Daily OHLCV prices ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_prices (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol       VARCHAR(20)  NOT NULL,
  exchange     ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  trade_date   DATE         NOT NULL,
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
) ENGINE=InnoDB;

-- ─── 4. Trading signals ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol          VARCHAR(20)  NOT NULL,
  signal_type     ENUM('BUY','SELL','HOLD') NOT NULL,
  strategy        VARCHAR(60)  NOT NULL,
  confidence      DECIMAL(5,4) NOT NULL,
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
  INDEX idx_regime      (regime),
  INDEX idx_ts_desc     (signal_ts DESC)
) ENGINE=InnoDB;

-- ─── 5. Backtest runs ────────────────────────────────────────────────────────
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
  calmar_ratio          DECIMAL(8,4),
  max_drawdown_pct      DECIMAL(8,4),
  win_rate_pct          DECIMAL(8,4),
  total_trades          INT UNSIGNED DEFAULT 0,
  winning_trades        INT UNSIGNED DEFAULT 0,
  losing_trades         INT UNSIGNED DEFAULT 0,
  avg_profit_pct        DECIMAL(8,4),
  avg_loss_pct          DECIMAL(8,4),
  profit_factor         DECIMAL(8,4),
  total_costs           DECIMAL(14,4),
  parameters            JSON,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symbol_strategy  (symbol, strategy),
  INDEX idx_sharpe           (sharpe_ratio DESC),
  INDEX idx_created_at       (created_at DESC)
) ENGINE=InnoDB;

-- ─── 6. Backtest trades ──────────────────────────────────────────────────────
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
  slippage    DECIMAL(12,4) DEFAULT 0,
  exit_reason ENUM('SIGNAL','STOP_LOSS','TAKE_PROFIT','END_OF_DATA') DEFAULT 'SIGNAL',
  regime      VARCHAR(20),
  FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
  INDEX idx_run_id    (run_id),
  INDEX idx_symbol    (symbol),
  INDEX idx_exit_reason (exit_reason)
) ENGINE=InnoDB;

-- ─── 7. Paper trades ─────────────────────────────────────────────────────────
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
  status            ENUM('PENDING','EXECUTED','CANCELLED','REJECTED','NO_FILL') NOT NULL DEFAULT 'PENDING',
  strategy          VARCHAR(60),
  signal_id         BIGINT UNSIGNED,
  stop_loss_price   DECIMAL(12,4),
  take_profit_price DECIMAL(12,4),
  pnl               DECIMAL(14,4),
  pnl_pct           DECIMAL(8,4),
  commission        DECIMAL(12,4) DEFAULT 0,
  fill_pct          DECIMAL(5,4) DEFAULT 1.0,
  delay_ms          INT UNSIGNED DEFAULT 0,
  regime            VARCHAR(20),
  notes             TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at       DATETIME,
  INDEX idx_symbol_status (symbol, status),
  INDEX idx_created_at    (created_at DESC),
  INDEX idx_side          (side),
  INDEX idx_strategy      (strategy)
) ENGINE=InnoDB;

-- ─── 8. Portfolio positions ───────────────────────────────────────────────────
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
  UNIQUE KEY uq_symbol (symbol, exchange),
  INDEX idx_last_updated (last_updated DESC)
) ENGINE=InnoDB;

-- ─── 9. Performance metrics (NEW) ────────────────────────────────────────────
-- Daily snapshot of portfolio performance for charting and analysis
CREATE TABLE IF NOT EXISTS performance_metrics (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  metric_date     DATE NOT NULL,
  total_equity    DECIMAL(14,2) NOT NULL,
  cash            DECIMAL(14,2),
  market_value    DECIMAL(14,2),
  daily_pnl       DECIMAL(14,4),
  daily_return    DECIMAL(10,6),
  total_return    DECIMAL(10,6),
  drawdown        DECIMAL(10,6),
  open_positions  INT UNSIGNED DEFAULT 0,
  trades_today    INT UNSIGNED DEFAULT 0,
  sharpe_ytd      DECIMAL(8,4),
  notes           TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_date (metric_date),
  INDEX idx_metric_date (metric_date DESC)
) ENGINE=InnoDB;

-- ─── 10. Data fetch audit ─────────────────────────────────────────────────────
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
) ENGINE=InnoDB;

-- ─── 11. System health log (NEW) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_health (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  db_status   ENUM('ok','error') NOT NULL DEFAULT 'ok',
  heap_mb     INT UNSIGNED,
  uptime_s    INT UNSIGNED,
  open_pos    INT UNSIGNED DEFAULT 0,
  error_msg   TEXT,
  INDEX idx_checked_at (checked_at DESC)
) ENGINE=InnoDB;
