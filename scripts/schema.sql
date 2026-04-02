-- scripts/schema.sql
-- Systematic Trading Engine — MySQL Schema
-- Run: mysql -u root -p trading_engine < scripts/schema.sql

CREATE DATABASE IF NOT EXISTS trading_engine
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;


-- ─── 1. Instruments ─────────────────────────────────────────────────────────
-- Master list of traded instruments
CREATE TABLE IF NOT EXISTS instruments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol        VARCHAR(20)  NOT NULL,
  company_name  VARCHAR(150),
  exchange      ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  series        VARCHAR(5)   DEFAULT 'EQ',
  isin          VARCHAR(12),
  sector        VARCHAR(80),
  industry      VARCHAR(80),
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_exchange (symbol, exchange)
) ENGINE=InnoDB;

-- ─── 2. Daily OHLCV prices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_prices (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol        VARCHAR(20)  NOT NULL,
  exchange      ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  trade_date    DATE         NOT NULL,
  open_price    DECIMAL(12,4) NOT NULL,
  high_price    DECIMAL(12,4) NOT NULL,
  low_price     DECIMAL(12,4) NOT NULL,
  close_price   DECIMAL(12,4) NOT NULL,
  vwap          DECIMAL(12,4),
  volume        BIGINT UNSIGNED DEFAULT 0,
  delivery_qty  BIGINT UNSIGNED DEFAULT 0,
  delivery_pct  DECIMAL(6,2),
  num_trades    INT UNSIGNED,
  prev_close    DECIMAL(12,4),
  change_pct    DECIMAL(8,4),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_date (symbol, exchange, trade_date),
  INDEX idx_symbol        (symbol),
  INDEX idx_trade_date    (trade_date),
  INDEX idx_symbol_date2  (symbol, trade_date)
) ENGINE=InnoDB;

-- ─── 3. Intraday prices (1-min OHLCV) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS intraday_prices (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol        VARCHAR(20)  NOT NULL,
  exchange      ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  ts            DATETIME(3)  NOT NULL,
  open_price    DECIMAL(12,4) NOT NULL,
  high_price    DECIMAL(12,4) NOT NULL,
  low_price     DECIMAL(12,4) NOT NULL,
  close_price   DECIMAL(12,4) NOT NULL,
  volume        BIGINT UNSIGNED DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_ts (symbol, ts),
  INDEX idx_symbol_ts (symbol, ts)
) ENGINE=InnoDB;

-- ─── 4. Trading signals ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol          VARCHAR(20)  NOT NULL,
  signal_type     ENUM('BUY','SELL','HOLD') NOT NULL,
  strategy        VARCHAR(60)  NOT NULL,   -- 'MEAN_REVERSION' | 'MA_CROSSOVER' | 'RSI' | 'AGGREGATED'
  confidence      DECIMAL(5,4) NOT NULL,   -- 0.0 – 1.0
  price_at_signal DECIMAL(12,4),
  z_score         DECIMAL(10,6),
  rsi_value       DECIMAL(8,4),
  ma_fast         DECIMAL(12,4),
  ma_slow         DECIMAL(12,4),
  metadata        JSON,
  signal_ts       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symbol_ts   (symbol, signal_ts),
  INDEX idx_strategy    (strategy),
  INDEX idx_signal_type (signal_type)
) ENGINE=InnoDB;

-- ─── 5. Backtest runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_runs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_name        VARCHAR(120),
  symbol          VARCHAR(20)  NOT NULL,
  strategy        VARCHAR(60)  NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  initial_capital DECIMAL(14,2) NOT NULL,
  final_capital   DECIMAL(14,2),
  total_return_pct DECIMAL(10,4),
  annualised_return_pct DECIMAL(10,4),
  sharpe_ratio    DECIMAL(8,4),
  max_drawdown_pct DECIMAL(8,4),
  win_rate_pct    DECIMAL(8,4),
  total_trades    INT UNSIGNED DEFAULT 0,
  winning_trades  INT UNSIGNED DEFAULT 0,
  losing_trades   INT UNSIGNED DEFAULT 0,
  avg_profit_pct  DECIMAL(8,4),
  avg_loss_pct    DECIMAL(8,4),
  profit_factor   DECIMAL(8,4),
  parameters      JSON,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symbol_strategy (symbol, strategy)
) ENGINE=InnoDB;

-- ─── 6. Backtest trades ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_trades (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id          BIGINT UNSIGNED NOT NULL,
  symbol          VARCHAR(20) NOT NULL,
  side            ENUM('BUY','SELL') NOT NULL,
  entry_date      DATE NOT NULL,
  entry_price     DECIMAL(12,4) NOT NULL,
  exit_date       DATE,
  exit_price      DECIMAL(12,4),
  quantity        INT UNSIGNED NOT NULL,
  pnl             DECIMAL(14,4),
  pnl_pct         DECIMAL(8,4),
  commission      DECIMAL(12,4) DEFAULT 0,
  slippage        DECIMAL(12,4) DEFAULT 0,
  exit_reason     ENUM('SIGNAL','STOP_LOSS','TAKE_PROFIT','END_OF_DATA') DEFAULT 'SIGNAL',
  FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
  INDEX idx_run_id (run_id)
) ENGINE=InnoDB;

-- ─── 7. Paper trades (live simulation) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_trades (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id        VARCHAR(40)  NOT NULL UNIQUE,
  symbol          VARCHAR(20)  NOT NULL,
  exchange        ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  order_type      ENUM('MARKET','LIMIT','SL','SL-M') NOT NULL DEFAULT 'MARKET',
  side            ENUM('BUY','SELL') NOT NULL,
  quantity        INT UNSIGNED NOT NULL,
  limit_price     DECIMAL(12,4),
  stop_price      DECIMAL(12,4),
  executed_price  DECIMAL(12,4),
  status          ENUM('PENDING','OPEN','EXECUTED','CANCELLED','REJECTED') NOT NULL DEFAULT 'PENDING',
  strategy        VARCHAR(60),
  signal_id       BIGINT UNSIGNED,
  stop_loss_price DECIMAL(12,4),
  take_profit_price DECIMAL(12,4),
  pnl             DECIMAL(14,4),
  pnl_pct         DECIMAL(8,4),
  commission      DECIMAL(12,4) DEFAULT 0,
  notes           TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at     DATETIME,
  closed_at       DATETIME,
  INDEX idx_symbol_status (symbol, status),
  INDEX idx_created_at    (created_at)
) ENGINE=InnoDB;

-- ─── 8. Portfolio (aggregated positions) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol          VARCHAR(20)  NOT NULL,
  exchange        ENUM('NSE','BSE') NOT NULL DEFAULT 'NSE',
  quantity        INT NOT NULL DEFAULT 0,         -- positive = long, negative = short
  avg_cost        DECIMAL(12,4),
  current_price   DECIMAL(12,4),
  market_value    DECIMAL(14,4),
  unrealised_pnl  DECIMAL(14,4),
  realised_pnl    DECIMAL(14,4) DEFAULT 0,
  last_updated    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol (symbol, exchange)
) ENGINE=InnoDB;

-- ─── 9. Data fetch audit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_fetch_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol      VARCHAR(20),
  source      VARCHAR(40) NOT NULL,   -- 'NSE_API' | 'CSV_IMPORT' | 'SEED'
  fetch_date  DATE,
  rows_saved  INT UNSIGNED DEFAULT 0,
  status      ENUM('SUCCESS','PARTIAL','FAILED') NOT NULL,
  error_msg   TEXT,
  duration_ms INT UNSIGNED,
  fetched_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symbol_date (symbol, fetched_at)
) ENGINE=InnoDB;
