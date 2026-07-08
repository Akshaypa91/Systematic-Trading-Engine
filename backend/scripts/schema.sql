-- Systematic Trading Engine — TiDB Cloud (MySQL protocol) schema.
-- The executable canonical schema is generated from backend/src/config/initDB.js.
-- Run it with: node scripts/migrate.js
-- This file is a static reference copy — regenerate after changing initDB.js.

CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(512),
        name VARCHAR(150),
        role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        provider VARCHAR(20) NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'google')),
        google_id VARCHAR(255),
        picture TEXT,
        trading_mode VARCHAR(20) NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_login TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(150);

ALTER TABLE users ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'local';

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);

ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS trading_mode VARCHAR(20) NOT NULL DEFAULT 'paper';

ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE users MODIFY COLUMN password VARCHAR(512) NULL;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id);

CREATE TABLE IF NOT EXISTS instruments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        company_name VARCHAR(150),
        exchange VARCHAR(10) NOT NULL DEFAULT 'NSE' CHECK (exchange IN ('NSE', 'BSE')),
        series VARCHAR(5) DEFAULT 'EQ',
        isin VARCHAR(12),
        sector VARCHAR(80),
        industry VARCHAR(80),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_instruments_symbol_exchange UNIQUE (symbol, exchange)
      );

ALTER TABLE instruments ADD COLUMN IF NOT EXISTS industry VARCHAR(80);

ALTER TABLE instruments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_instruments_sector ON instruments (sector);

CREATE INDEX IF NOT EXISTS idx_instruments_active ON instruments (is_active);

CREATE TABLE IF NOT EXISTS daily_prices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(10) NOT NULL DEFAULT 'NSE' CHECK (exchange IN ('NSE', 'BSE')),
        trade_date DATE NOT NULL,
        open_price DECIMAL(12,4) NOT NULL,
        high_price DECIMAL(12,4) NOT NULL,
        low_price DECIMAL(12,4) NOT NULL,
        close_price DECIMAL(12,4) NOT NULL,
        vwap DECIMAL(12,4),
        volume BIGINT DEFAULT 0,
        delivery_qty BIGINT DEFAULT 0,
        delivery_pct DECIMAL(6,2),
        num_trades INT,
        prev_close DECIMAL(12,4),
        change_pct DECIMAL(8,4),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_daily_prices_symbol_date UNIQUE (symbol, exchange, trade_date)
      );

CREATE INDEX IF NOT EXISTS idx_daily_prices_symbol ON daily_prices (symbol);

CREATE INDEX IF NOT EXISTS idx_daily_prices_trade_date ON daily_prices (trade_date);

CREATE INDEX IF NOT EXISTS idx_daily_prices_symbol_date_close ON daily_prices (symbol, trade_date, close_price);

CREATE TABLE IF NOT EXISTS intraday_prices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(10) NOT NULL DEFAULT 'NSE' CHECK (exchange IN ('NSE', 'BSE')),
        ts TIMESTAMP NOT NULL,
        open_price DECIMAL(12,4) NOT NULL,
        high_price DECIMAL(12,4) NOT NULL,
        low_price DECIMAL(12,4) NOT NULL,
        close_price DECIMAL(12,4) NOT NULL,
        volume BIGINT DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_intraday_prices_symbol_ts UNIQUE (symbol, exchange, ts)
      );

CREATE TABLE IF NOT EXISTS signals (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        symbol VARCHAR(20) NOT NULL,
        signal_type VARCHAR(10) NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'HOLD')),
        strategy VARCHAR(60) NOT NULL,
        confidence DECIMAL(5,4),
        price_at_signal DECIMAL(12,4),
        z_score DECIMAL(10,6),
        rsi_value DECIMAL(8,4),
        ma_fast DECIMAL(12,4),
        ma_slow DECIMAL(12,4),
        regime VARCHAR(20),
        metadata JSON,
        signal_ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_signals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

ALTER TABLE signals ADD COLUMN IF NOT EXISTS regime VARCHAR(20);

ALTER TABLE signals ADD COLUMN IF NOT EXISTS metadata JSON;

CREATE INDEX IF NOT EXISTS idx_signals_user_ts ON signals (user_id, signal_ts DESC);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_ts ON signals (symbol, signal_ts);

CREATE INDEX IF NOT EXISTS idx_signals_strategy ON signals (strategy);

CREATE INDEX IF NOT EXISTS idx_signals_signal_type ON signals (signal_type);

CREATE INDEX IF NOT EXISTS idx_signals_ts_desc ON signals (signal_ts DESC);

CREATE TABLE IF NOT EXISTS backtest_runs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        run_name VARCHAR(120),
        symbol VARCHAR(20) NOT NULL,
        strategy VARCHAR(60) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        initial_capital DECIMAL(14,2) NOT NULL,
        final_capital DECIMAL(14,2),
        total_return_pct DECIMAL(10,4),
        annualised_return_pct DECIMAL(10,4),
        sharpe_ratio DECIMAL(8,4),
        sortino_ratio DECIMAL(8,4),
        calmar_ratio DECIMAL(8,4),
        max_drawdown_pct DECIMAL(8,4),
        win_rate_pct DECIMAL(8,4),
        total_trades INT DEFAULT 0,
        winning_trades INT DEFAULT 0,
        losing_trades INT DEFAULT 0,
        avg_profit_pct DECIMAL(8,4),
        avg_loss_pct DECIMAL(8,4),
        profit_factor DECIMAL(8,4),
        total_costs DECIMAL(14,4),
        parameters JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_backtest_runs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS sortino_ratio DECIMAL(8,4);

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS calmar_ratio DECIMAL(8,4);

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS avg_profit_pct DECIMAL(8,4);

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS avg_loss_pct DECIMAL(8,4);

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS profit_factor DECIMAL(8,4);

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS total_costs DECIMAL(14,4);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_symbol_strategy ON backtest_runs (symbol, strategy);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_user_created ON backtest_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at ON backtest_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS backtest_trades (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        run_id BIGINT NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
        entry_date DATE NOT NULL,
        entry_price DECIMAL(12,4) NOT NULL,
        exit_date DATE,
        exit_price DECIMAL(12,4),
        quantity INT NOT NULL,
        pnl DECIMAL(14,4),
        pnl_pct DECIMAL(8,4),
        commission DECIMAL(12,4) DEFAULT 0,
        slippage DECIMAL(12,4) DEFAULT 0,
        exit_reason VARCHAR(30) DEFAULT 'SIGNAL' CHECK (exit_reason IN ('SIGNAL', 'STOP_LOSS', 'TAKE_PROFIT', 'END_OF_DATA')),
        regime VARCHAR(20),
        CONSTRAINT fk_backtest_trades_run FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
      );

ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS slippage DECIMAL(12,4) DEFAULT 0;

ALTER TABLE backtest_trades ADD COLUMN IF NOT EXISTS regime VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_id ON backtest_trades (run_id);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol ON backtest_trades (symbol);

CREATE TABLE IF NOT EXISTS paper_trades (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        order_id VARCHAR(40) NOT NULL UNIQUE,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(10) NOT NULL DEFAULT 'NSE' CHECK (exchange IN ('NSE', 'BSE')),
        order_type VARCHAR(10) NOT NULL DEFAULT 'MARKET' CHECK (order_type IN ('MARKET', 'LIMIT', 'SL', 'SL-M')),
        side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quantity INT NOT NULL,
        limit_price DECIMAL(12,4),
        stop_price DECIMAL(12,4),
        executed_price DECIMAL(12,4),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTED', 'CANCELLED', 'REJECTED', 'NO_FILL')),
        strategy VARCHAR(60),
        signal_id BIGINT,
        stop_loss_price DECIMAL(12,4),
        take_profit_price DECIMAL(12,4),
        pnl DECIMAL(14,4),
        pnl_pct DECIMAL(8,4),
        commission DECIMAL(12,4) DEFAULT 0,
        fill_pct DECIMAL(5,4) DEFAULT 1.0,
        delay_ms INT DEFAULT 0,
        regime VARCHAR(20),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        executed_at TIMESTAMP NULL,
        closed_at TIMESTAMP NULL,
        CONSTRAINT fk_paper_trades_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS stop_price DECIMAL(12,4);

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS signal_id BIGINT;

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS stop_loss_price DECIMAL(12,4);

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS take_profit_price DECIMAL(12,4);

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS pnl_pct DECIMAL(8,4);

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS fill_pct DECIMAL(5,4) DEFAULT 1.0;

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS delay_ms INT DEFAULT 0;

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS regime VARCHAR(20);

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_paper_trades_user_created ON paper_trades (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_status ON paper_trades (symbol, status);

CREATE INDEX IF NOT EXISTS idx_paper_trades_created_at ON paper_trades (created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(10) NOT NULL DEFAULT 'NSE' CHECK (exchange IN ('NSE', 'BSE')),
        quantity INT NOT NULL DEFAULT 0,
        avg_cost DECIMAL(12,4),
        current_price DECIMAL(12,4),
        market_value DECIMAL(14,4),
        unrealised_pnl DECIMAL(14,4),
        realised_pnl DECIMAL(14,4) DEFAULT 0,
        last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_portfolio_symbol_user UNIQUE (user_id, symbol, exchange),
        CONSTRAINT fk_portfolio_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_portfolio_user_symbol ON portfolio (user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_portfolio_last_updated ON portfolio (last_updated DESC);

CREATE TABLE IF NOT EXISTS performance_metrics (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        metric_date DATE NOT NULL,
        total_equity DECIMAL(14,2) NOT NULL,
        cash DECIMAL(14,2),
        market_value DECIMAL(14,2),
        daily_pnl DECIMAL(14,4),
        daily_return DECIMAL(10,6),
        total_return DECIMAL(10,6),
        drawdown DECIMAL(10,6),
        open_positions INT DEFAULT 0,
        trades_today INT DEFAULT 0,
        sharpe_ytd DECIMAL(8,4),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_performance_metrics_user_date UNIQUE (user_id, metric_date),
        CONSTRAINT fk_performance_metrics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS sharpe_ytd DECIMAL(8,4);

ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_performance_metrics_user_date ON performance_metrics (user_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_date ON performance_metrics (metric_date DESC);

CREATE TABLE IF NOT EXISTS data_fetch_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20),
        source VARCHAR(40) NOT NULL,
        fetch_date DATE,
        rows_saved INT DEFAULT 0,
        status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
        error_msg TEXT,
        duration_ms INT,
        fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

CREATE INDEX IF NOT EXISTS idx_data_fetch_log_symbol_date ON data_fetch_log (symbol, fetched_at);

CREATE INDEX IF NOT EXISTS idx_data_fetch_log_status ON data_fetch_log (status);

CREATE TABLE IF NOT EXISTS system_health (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        db_status VARCHAR(10) NOT NULL DEFAULT 'ok' CHECK (db_status IN ('ok', 'error')),
        heap_mb INT,
        uptime_s INT,
        open_pos INT DEFAULT 0,
        error_msg TEXT
      );

CREATE INDEX IF NOT EXISTS idx_system_health_checked_at ON system_health (checked_at DESC);

CREATE TABLE IF NOT EXISTS portfolios (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        initial_capital DECIMAL(16,2) NOT NULL,
        current_capital DECIMAL(16,2) NOT NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESET', 'CLOSED')),
        active_user_key INT AS (CASE WHEN status = 'ACTIVE' THEN COALESCE(user_id, -1) ELSE NULL END) STORED,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_portfolios_active_user UNIQUE (active_user_key)
      );

ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios (user_id);

CREATE INDEX IF NOT EXISTS idx_portfolios_status ON portfolios (status);

CREATE INDEX IF NOT EXISTS idx_portfolios_created ON portfolios (created_at DESC);

CREATE TABLE IF NOT EXISTS password_resets (
        user_id INT NOT NULL PRIMARY KEY,
        token VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token);

CREATE TABLE IF NOT EXISTS feedback (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        name VARCHAR(100),
        email VARCHAR(255),
        type VARCHAR(50) NOT NULL DEFAULT 'general',
        message TEXT NOT NULL,
        rating INT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback (type);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS sim_trades (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        portfolio_id BIGINT NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        action VARCHAR(10) NOT NULL CHECK (action IN ('BUY', 'SELL')),
        qty INT NOT NULL,
        price DECIMAL(12,4) NOT NULL,
        value DECIMAL(16,4) NOT NULL,
        pnl DECIMAL(14,4),
        price_source VARCHAR(10) NOT NULL DEFAULT 'SIM' CHECK (price_source IN ('API', 'SIM', 'MANUAL')),
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sim_trades_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_sim_trades_portfolio_symbol ON sim_trades (portfolio_id, symbol);

CREATE INDEX IF NOT EXISTS idx_sim_trades_portfolio_ts ON sim_trades (portfolio_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_sim_trades_executed_at ON sim_trades (executed_at DESC);

CREATE TABLE IF NOT EXISTS watchlists (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(10) NOT NULL DEFAULT 'NSE' CHECK (exchange IN ('NSE', 'BSE')),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_watchlists_user_symbol UNIQUE (user_id, symbol, exchange),
        CONSTRAINT fk_watchlists_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_watchlists_user_created ON watchlists (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trade_journal (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        trade_id BIGINT,
        symbol VARCHAR(20) NOT NULL,
        side VARCHAR(10) CHECK (side IS NULL OR side IN ('BUY', 'SELL')),
        entry_reason TEXT,
        exit_reason TEXT,
        notes TEXT,
        confidence_score DECIMAL(5,2) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
        screenshot_url TEXT,
        tags JSON NOT NULL,
        lessons_learned TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_trade_journal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_trade_journal_user_created ON trade_journal (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_journal_user_symbol ON trade_journal (user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_trade_journal_trade_id ON trade_journal (trade_id);

CREATE TABLE IF NOT EXISTS broker_accounts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(30) NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TIMESTAMP NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_broker_accounts_user_provider UNIQUE (user_id, provider),
        CONSTRAINT fk_broker_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_broker_accounts_user ON broker_accounts (user_id);

CREATE TABLE IF NOT EXISTS live_orders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        broker_order_id VARCHAR(100),
        symbol VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
        qty INT NOT NULL,
        price DECIMAL(12,4),
        order_type VARCHAR(10) NOT NULL DEFAULT 'MARKET',
        status VARCHAR(20) NOT NULL,
        provider VARCHAR(30) NOT NULL DEFAULT 'upstox',
        raw_response JSON,
        error_message TEXT,
        confirmed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_live_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

CREATE INDEX IF NOT EXISTS idx_live_orders_user_created ON live_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_orders_broker_order ON live_orders (broker_order_id);

CREATE TABLE IF NOT EXISTS system_flags (
        flag_key VARCHAR(100) PRIMARY KEY,
        flag_value VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        action VARCHAR(120) NOT NULL,
        ip VARCHAR(45),
        user_agent TEXT,
        trace_id VARCHAR(80),
        metadata JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
