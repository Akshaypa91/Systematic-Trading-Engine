// scripts/reseed-prices.js
// Run: node scripts/reseed-prices.js
// Clears daily_prices and reseeds with realistic NSE-like data (~0.8% daily vol)
'use strict';

require('dotenv').config();
const db = require('../src/config/database');

const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'WIPRO', 'SBIN', 'AXISBANK'];

const START_PRICES = {
  RELIANCE: 2400, TCS: 3500, INFY: 1700, HDFCBANK: 1500,
  ICICIBANK: 750, WIPRO: 650, SBIN: 450, AXISBANK: 720,
};

function generatePrices(symbol) {
  const rows  = [];
  let price   = START_PRICES[symbol] || 1000;
  const start = new Date('2022-01-01');
  const end   = new Date('2024-12-31');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue;

    // Realistic NSE volatility: ~0.8% daily, slight upward drift
    const drift  = 0.0002;                              // ~5% annual drift
    const vol    = 0.008;                               // 0.8% daily vol (was 2.5%!)
    const change = drift + vol * (Math.random() * 2 - 1);
    price        = Math.max(price * (1 + change), 10);

    const open   = parseFloat((price * (1 + (Math.random() - 0.5) * 0.003)).toFixed(2));
    const close  = parseFloat(price.toFixed(2));
    const high   = parseFloat((Math.max(open, close) * (1 + Math.random() * 0.006)).toFixed(2));
    const low    = parseFloat((Math.min(open, close) * (1 - Math.random() * 0.006)).toFixed(2));
    const vwap   = parseFloat(((open + high + low + close) / 4).toFixed(2));
    const vol_   = Math.floor(Math.random() * 5000000 + 500000);
    const prev   = rows.length ? rows[rows.length - 1][6] : open; // index 6 = close_price
    const chgPct = parseFloat(((close - prev) / prev * 100).toFixed(4));

    rows.push([
      symbol, 'NSE',
      d.toISOString().slice(0, 10),
      open, high, low, close, vwap, vol_,
      Math.floor(vol_ * 0.4),
      40.00,
      Math.floor(vol_ / 50),
      prev, chgPct
    ]);
  }
  return rows;
}

async function main() {
  await db.testConnection();
  console.log('\n[reseed] Clearing old price data...');
  await db.query('DELETE FROM daily_prices');
  console.log('[reseed] Cleared. Reseeding with realistic data...\n');

  for (const symbol of SYMBOLS) {
    const rows = generatePrices(symbol);
    let inserted = 0;

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      try {
        await db.query(
          `INSERT INTO daily_prices
            (symbol, exchange, trade_date, open_price, high_price, low_price,
             close_price, vwap, volume, delivery_qty, delivery_pct,
             num_trades, prev_close, change_pct)
           VALUES ${placeholders}
           ON CONFLICT (symbol, exchange, trade_date) DO NOTHING`,
          chunk.flat()
        );
        inserted += chunk.length;
      } catch (e) {
        console.error(`  chunk error for ${symbol}: ${e.message}`);
      }
    }

    const finalPrice = rows[rows.length - 1][6];
    const startPrice = rows[0][6];
    const totalReturn = ((finalPrice - startPrice) / startPrice * 100).toFixed(1);
    console.log(`  ✓ ${symbol}: ${inserted} rows | ₹${startPrice.toFixed(0)} → ₹${finalPrice.toFixed(0)} (${totalReturn > 0 ? '+' : ''}${totalReturn}%)`);
  }

  console.log('\n[reseed] ✅ Done! Restart your backend and run a backtest.\n');
  process.exit(0);
}

main().catch(e => { console.error('[reseed] FATAL:', e.message); process.exit(1); });
