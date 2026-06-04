// scripts/setup-complete.js
// Creates CockroachDB/PostgreSQL tables and seeds synthetic daily_prices data.
'use strict';

require('dotenv').config();
const db = require('../src/config/database');
const { initDB } = require('../src/config/initDB');
const dataStore = require('../src/data/dataStore');

const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'WIPRO', 'SBIN', 'AXISBANK'];

const START_PRICES = {
  RELIANCE: 2400, TCS: 3500, INFY: 1700, HDFCBANK: 1500,
  ICICIBANK: 750, WIPRO: 650, SBIN: 450, AXISBANK: 720,
};

function generatePrices(symbol) {
  const rows = [];
  let price = START_PRICES[symbol] || 1000;
  const start = new Date('2022-01-01');
  const end = new Date('2024-12-31');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue;

    const change = (Math.random() - 0.48) * 0.025;
    price = Math.max(price * (1 + change), 10);

    const open = parseFloat((price * (1 + (Math.random() - 0.5) * 0.005)).toFixed(2));
    const close = parseFloat(price.toFixed(2));
    const high = parseFloat((Math.max(open, close) * (1 + Math.random() * 0.012)).toFixed(2));
    const low = parseFloat((Math.min(open, close) * (1 - Math.random() * 0.012)).toFixed(2));
    const vwap = parseFloat(((open + high + low + close) / 4).toFixed(2));
    const volume = Math.floor(Math.random() * 5000000 + 500000);
    const prevClose = rows.length ? rows[rows.length - 1].close : open;
    const changePct = parseFloat(((close - prevClose) / prevClose * 100).toFixed(4));

    rows.push({
      symbol,
      exchange: 'NSE',
      date: d.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      vwap,
      volume,
      deliveryQty: Math.floor(volume * 0.4),
      deliveryPct: 40,
      trades: Math.floor(volume / 50),
      prevClose,
      changePct,
    });
  }
  return rows;
}

async function upsertInstruments() {
  for (const symbol of SYMBOLS) {
    await db.query(
      `INSERT INTO instruments (symbol, exchange, is_active)
       VALUES (?, 'NSE', true)
       ON CONFLICT (symbol, exchange) DO UPDATE
       SET is_active = true,
           updated_at = CURRENT_TIMESTAMP`,
      [symbol]
    );
  }
}

async function main() {
  await db.testConnection();
  console.log('\n[setup] Creating CockroachDB/PostgreSQL schema');
  const result = await initDB();
  if (result.failed.length) {
    throw new Error(`Schema initialization failed for: ${result.failed.join(', ')}`);
  }

  await upsertInstruments();

  const [countRows] = await db.query('SELECT COUNT(*) AS cnt FROM daily_prices');
  const existingCount = Number(countRows[0].cnt);

  if (existingCount > 5000) {
    console.log(`\n[setup] daily_prices already has ${existingCount} rows; skipping seed`);
  } else {
    console.log('\n[setup] Seeding daily_prices');
    let total = 0;
    for (const symbol of SYMBOLS) {
      const rows = generatePrices(symbol);
      for (let i = 0; i < rows.length; i += 200) {
        total += await dataStore.saveDailyPrices(rows.slice(i, i + 200));
      }
      console.log(`  ${symbol}: ${rows.length} rows`);
    }
    console.log(`[setup] Seeded ${total} rows`);
  }

  console.log('\n[setup] Complete. Restart the backend with: node src/app.js\n');
  process.exit(0);
}

main().catch(e => {
  console.error('\n[setup] FATAL:', e.message);
  process.exit(1);
});
