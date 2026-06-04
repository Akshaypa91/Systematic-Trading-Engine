// scripts/seed-sample-data.js
// Generates synthetic OHLCV data using Geometric Brownian Motion (GBM)
// S(t) = S(t-1) * exp((mu - sigma^2/2)*dt + sigma*sqrt(dt)*Z),  Z ~ N(0,1)
'use strict';

require('dotenv').config();
const db     = require('../src/config/database');
const logger = require('../src/config/logger');

const SYMBOLS = [
  { symbol: 'RELIANCE', startPrice: 2400, mu: 0.12, sigma: 0.22 },
  { symbol: 'INFY',     startPrice: 1450, mu: 0.10, sigma: 0.20 },
  { symbol: 'HDFCBANK', startPrice: 1600, mu: 0.09, sigma: 0.18 },
  { symbol: 'TCS',      startPrice: 3500, mu: 0.11, sigma: 0.19 },
  { symbol: 'WIPRO',    startPrice: 450,  mu: 0.08, sigma: 0.24 },
];

const START_DATE = new Date('2022-01-03');
const DAYS       = 500;

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateGBM(start, mu, sigma, n) {
  const dt = 1/252;
  const prices = [start];
  for (let i = 1; i < n; i++) {
    const next = prices[i-1] * Math.exp((mu - 0.5*sigma**2)*dt + sigma*Math.sqrt(dt)*randn());
    prices.push(parseFloat(next.toFixed(4)));
  }
  return prices;
}

function addTradingDays(start, n) {
  const dates = []; const d = new Date(start);
  while (dates.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function seedSymbol({ symbol, startPrice, mu, sigma }) {
  const closes = generateGBM(startPrice, mu, sigma, DAYS);
  const dates  = addTradingDays(START_DATE, DAYS);

  const rows = dates.map((date, i) => {
    const c   = closes[i];
    const rng = c * (0.005 + Math.abs(randn()) * 0.008);
    const o   = c * (1 + randn() * 0.005);
    const h   = Math.max(o, c) + rng * Math.abs(randn());
    const l   = Math.min(o, c) - rng * Math.abs(randn());
    return {
      symbol, exchange: 'NSE',
      date: date.toISOString().slice(0, 10),
      open:  parseFloat(Math.max(o, l+0.01).toFixed(4)),
      high:  parseFloat(Math.max(h, o, c).toFixed(4)),
      low:   parseFloat(Math.min(l, o, c).toFixed(4)),
      close: parseFloat(c.toFixed(4)),
      vwap:  parseFloat(((o+h+l+c)/4).toFixed(4)),
      volume: Math.floor(500000 + Math.random() * 4500000),
    };
  });

  const CHUNK = 100; let saved = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i+CHUNK);
    const ph    = chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    const vals  = chunk.flatMap(r => [r.symbol,r.exchange,r.date,r.open,r.high,r.low,r.close,r.vwap,r.volume]);
    await db.query(`
      INSERT INTO daily_prices
        (symbol,exchange,trade_date,open_price,high_price,low_price,close_price,vwap,volume)
      VALUES ${ph}
      ON CONFLICT (symbol, exchange, trade_date) DO UPDATE
      SET open_price = EXCLUDED.open_price,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          close_price = EXCLUDED.close_price,
          vwap = EXCLUDED.vwap,
          volume = EXCLUDED.volume
    `, vals);
    saved += chunk.length;
  }
  logger.info(`[Seed] ${symbol}: ${saved} rows (${rows[0].date} -> ${rows[rows.length-1].date})`);
  return saved;
}

async function run() {
  await db.testConnection();
  logger.info('[Seed] Generating GBM price series...');
  for (const { symbol } of SYMBOLS) {
    await db.query(
      `INSERT INTO instruments (symbol, exchange, is_active)
       VALUES (?, 'NSE', true)
       ON CONFLICT (symbol, exchange) DO UPDATE
       SET is_active = true,
           updated_at = CURRENT_TIMESTAMP`,
      [symbol]
    );
  }
  let total = 0;
  for (const sym of SYMBOLS) total += await seedSymbol(sym);
  logger.info(`[Seed] Done. Total rows: ${total}`);
  process.exit(0);
}

run().catch(err => { console.error(err.message); process.exit(1); });
