-- TiDB Cloud (MySQL protocol) portfolio tables.
-- Superseded by the full migration: node scripts/migrate.js (runs
-- src/config/initDB.js, which already creates these same tables). Kept for
-- standalone use; converted from Postgres to MySQL/TiDB syntax to match.

CREATE TABLE IF NOT EXISTS portfolios (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  initial_capital DECIMAL(16,2) NOT NULL,
  current_capital DECIMAL(16,2) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESET', 'CLOSED')),
  -- Emulates Postgres's partial unique index (one ACTIVE portfolio per
  -- user, or one ACTIVE anonymous portfolio) via a generated column +
  -- plain unique index — MySQL/TiDB has no partial/filtered index support.
  active_user_key INT AS (CASE WHEN status = 'ACTIVE' THEN COALESCE(user_id, -1) ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_portfolios_active_user UNIQUE (active_user_key)
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios (user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_status ON portfolios (status);

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
