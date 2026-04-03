// scripts/setup-complete.js
// Run: node scripts/setup-complete.js
// Creates all missing tables AND seeds 2 years of synthetic daily_prices for testing
'use strict';

require('dotenv').config();
const db = require('../src/config/database');

// ── Table definitions ──────────────────────────────────────────────────────────
const TABLES = [
  `CREATE TABLE IF NOT EXISTS instruments (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol        VARCHAR(20)  NOT NULL,
    company_name  VARCHAR(150),
    exchange      VARCHAR(10)  NOT NULL DEFAULT 'NSE',
    series        VARCHAR(5)   DEFAULT 'EQ',
    isin          VARCHAR(12),
    sector        VARCHAR(80),
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_symbol_exchange (symbol, exchange)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS daily_prices (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol        VARCHAR(20)  NOT NULL,
    exchange      VARCHAR(10)  NOT NULL DEFAULT 'NSE',
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
    INDEX idx_symbol     (symbol),
    INDEX idx_trade_date (trade_date)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS intraday_prices (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol        VARCHAR(20)  NOT NULL,
    exchange      VARCHAR(10)  NOT NULL DEFAULT 'NSE',
    ts            DATETIME(3)  NOT NULL,
    open_price    DECIMAL(12,4) NOT NULL,
    high_price    DECIMAL(12,4) NOT NULL,
    low_price     DECIMAL(12,4) NOT NULL,
    close_price   DECIMAL(12,4) NOT NULL,
    volume        BIGINT UNSIGNED DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_symbol_ts (symbol, ts)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS signals (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol          VARCHAR(20)  NOT NULL,
    signal_type     VARCHAR(10)  NOT NULL,
    strategy        VARCHAR(60)  NOT NULL,
    confidence      DECIMAL(5,4) NOT NULL,
    price_at_signal DECIMAL(12,4),
    z_score         DECIMAL(10,6),
    rsi_value       DECIMAL(8,4),
    ma_fast         DECIMAL(12,4),
    ma_slow         DECIMAL(12,4),
    signal_ts       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol_ts (symbol, signal_ts)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS backtest_runs (
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
    max_drawdown_pct      DECIMAL(8,4),
    win_rate_pct          DECIMAL(8,4),
    total_trades          INT UNSIGNED DEFAULT 0,
    winning_trades        INT UNSIGNED DEFAULT 0,
    losing_trades         INT UNSIGNED DEFAULT 0,
    avg_profit_pct        DECIMAL(8,4),
    avg_loss_pct          DECIMAL(8,4),
    profit_factor         DECIMAL(8,4),
    parameters            JSON,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol_strategy (symbol, strategy)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS backtest_trades (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id       BIGINT UNSIGNED NOT NULL,
    symbol       VARCHAR(20) NOT NULL,
    side         VARCHAR(10) NOT NULL,
    entry_date   DATE NOT NULL,
    entry_price  DECIMAL(12,4) NOT NULL,
    exit_date    DATE,
    exit_price   DECIMAL(12,4),
    quantity     INT UNSIGNED NOT NULL,
    pnl          DECIMAL(14,4),
    pnl_pct      DECIMAL(8,4),
    commission   DECIMAL(12,4) DEFAULT 0,
    slippage     DECIMAL(12,4) DEFAULT 0,
    exit_reason  VARCHAR(30) DEFAULT 'SIGNAL',
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS paper_trades (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id          VARCHAR(40)  NOT NULL UNIQUE,
    symbol            VARCHAR(20)  NOT NULL,
    exchange          VARCHAR(10)  NOT NULL DEFAULT 'NSE',
    order_type        VARCHAR(10)  NOT NULL DEFAULT 'MARKET',
    side              VARCHAR(10)  NOT NULL,
    quantity          INT UNSIGNED NOT NULL,
    limit_price       DECIMAL(12,4),
    stop_price        DECIMAL(12,4),
    executed_price    DECIMAL(12,4),
    status            VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    strategy          VARCHAR(60),
    stop_loss_price   DECIMAL(12,4),
    take_profit_price DECIMAL(12,4),
    pnl               DECIMAL(14,4),
    pnl_pct           DECIMAL(8,4),
    commission        DECIMAL(12,4) DEFAULT 0,
    notes             TEXT,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    executed_at       DATETIME,
    closed_at         DATETIME,
    INDEX idx_symbol_status (symbol, status)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS portfolio (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol         VARCHAR(20)  NOT NULL,
    exchange       VARCHAR(10)  NOT NULL DEFAULT 'NSE',
    quantity       INT NOT NULL DEFAULT 0,
    avg_cost       DECIMAL(12,4),
    current_price  DECIMAL(12,4),
    market_value   DECIMAL(14,4),
    unrealised_pnl DECIMAL(14,4),
    realised_pnl   DECIMAL(14,4) DEFAULT 0,
    last_updated   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_symbol (symbol, exchange)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS data_fetch_log (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol      VARCHAR(20),
    source      VARCHAR(40) NOT NULL,
    fetch_date  DATE,
    rows_saved  INT UNSIGNED DEFAULT 0,
    status      VARCHAR(20) NOT NULL,
    error_msg   TEXT,
    duration_ms INT UNSIGNED,
    fetched_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS users (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    email      VARCHAR(255) NOT NULL UNIQUE,
    password   VARCHAR(512) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
];

// ── Seed synthetic OHLCV data ─────────────────────────────────────────────────
// Generates realistic-looking price data using a random walk
// Covers 2022-01-01 to 2024-12-31 (~750 trading days) for multiple symbols
const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'WIPRO', 'SBIN', 'AXISBANK'];

const START_PRICES = {
  RELIANCE: 2400, TCS: 3500, INFY: 1700, HDFCBANK: 1500,
  ICICIBANK: 750, WIPRO: 650, SBIN: 450, AXISBANK: 720,
};

function generatePrices(symbol) {
  const rows = [];
  let price = START_PRICES[symbol] || 1000;
  const start = new Date('2022-01-01');
  const end   = new Date('2024-12-31');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip weekends

    // Random walk with slight upward drift
    const change = (Math.random() - 0.48) * 0.025;
    price = Math.max(price * (1 + change), 10);

    const open  = parseFloat((price * (1 + (Math.random() - 0.5) * 0.005)).toFixed(2));
    const close = parseFloat(price.toFixed(2));
    const high  = parseFloat((Math.max(open, close) * (1 + Math.random() * 0.012)).toFixed(2));
    const low   = parseFloat((Math.min(open, close) * (1 - Math.random() * 0.012)).toFixed(2));
    const vwap  = parseFloat(((open + high + low + close) / 4).toFixed(2));
    const vol   = Math.floor(Math.random() * 5000000 + 500000);
    const prev  = rows.length ? rows[rows.length - 1][5] : open;
    const chgPct = parseFloat(((close - prev) / prev * 100).toFixed(4));

    rows.push([
      symbol, 'NSE',
      d.toISOString().slice(0, 10), // trade_date
      open, high, low, close, vwap, vol,
      Math.floor(vol * 0.4),        // delivery_qty
      40.00,                         // delivery_pct
      Math.floor(vol / 50),          // num_trades
      prev, chgPct
    ]);
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await db.testConnection();
  console.log('\n[setup] ── Creating tables ──');

  for (const sql of TABLES) {
    const name = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || '?';
    try {
      await db.query(sql);
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  // Check if daily_prices already has data
  const [countRows] = await db.query('SELECT COUNT(*) as cnt FROM daily_prices');
  const existingCount = countRows[0].cnt;

  if (existingCount > 5000) {
    console.log(`\n[setup] daily_prices already has ${existingCount} rows — skipping seed`);
  } else {
    console.log('\n[setup] ── Seeding daily_prices ──');
    console.log('  Generating ~750 trading days × 8 symbols...\n');

    for (const symbol of SYMBOLS) {
      const rows = generatePrices(symbol);
      let inserted = 0;

      // Batch insert in chunks of 100
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const placeholders = chunk.map(() =>
          '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).join(',');
        const values = chunk.flat();

        try {
          await db.query(
            `INSERT IGNORE INTO daily_prices
              (symbol, exchange, trade_date, open_price, high_price, low_price,
               close_price, vwap, volume, delivery_qty, delivery_pct,
               num_trades, prev_close, change_pct)
             VALUES ${placeholders}`,
            values
          );
          inserted += chunk.length;
        } catch (e) {
          console.error(`    chunk error: ${e.message}`);
        }
      }
      console.log(`  ✓ ${symbol}: ${inserted} rows`);
    }
  }

  // Fix the LIMIT integer bug — patch backtest controller
  console.log('\n[setup] ── Verifying backtest_runs query fix ──');
  try {
    const [rows] = await db.query(
      'SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT ?',
      [10]  // integer, not string
    );
    console.log(`  ✓ backtest_runs query OK (${rows.length} rows)`);
  } catch (e) {
    console.error(`  ✗ backtest_runs query: ${e.message}`);
  }

  console.log('\n[setup] ✅ Complete! Restart your backend: node src/app.js\n');
  process.exit(0);
}

main().catch(e => {
  console.error('\n[setup] FATAL:', e.message);
  process.exit(1);
});