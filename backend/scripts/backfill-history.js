// scripts/backfill-history.js
// ─────────────────────────────────────────────────────────────────────────────
// Fill daily_prices with REAL historical OHLCV from Yahoo Finance (no broker
// session needed). This is the honest replacement for the old reseed script,
// which generated a random walk — and since the whole engine now trusts stored
// closes (LAST_CLOSE signals, backtests, the paper trader), seeding fakes would
// poison every one of those paths at once.
//
//   node scripts/backfill-history.js                      # default watchlist
//   node scripts/backfill-history.js RELIANCE TCS INFY    # specific symbols
//   node scripts/backfill-history.js --years 3            # shorter window
//
// Idempotent: saveDailyPrices upserts on (symbol, exchange, date), so re-runs
// refresh rather than duplicate. Run it with your production .env to fill the
// deployed TiDB instance.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
require('dotenv').config();

const axios     = require('axios');
const dataStore = require('../src/data/dataStore');
const db        = require('../src/config/database');
const logger    = require('../src/config/logger');
logger.debug = () => {};

const DEFAULT_SYMBOLS = (process.env.SIM_WATCHLIST
  || 'RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,WIPRO,SBIN,AXISBANK,BAJFINANCE,KOTAKBANK')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchYahooDaily(symbol, years) {
  const to   = Math.floor(Date.now() / 1000);
  const from = to - years * 365 * 24 * 60 * 60;
  const res  = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS`,
    {
      params:  { period1: from, period2: to, interval: '1d', events: 'history' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      timeout: 20000,
    }
  );
  const result = res.data?.chart?.result?.[0];
  if (!result) throw new Error('empty chart result');

  const ts = result.timestamp || [];
  const q  = result.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null || !isFinite(close)) continue;   // Yahoo pads holidays with nulls
    rows.push({
      symbol,
      exchange: 'NSE',
      date:   new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open:   +(q.open?.[i]  ?? close).toFixed(2),
      high:   +(q.high?.[i]  ?? close).toFixed(2),
      low:    +(q.low?.[i]   ?? close).toFixed(2),
      close:  +close.toFixed(2),
      vwap:   null,
      volume: q.volume?.[i] ?? 0,
    });
  }
  return rows;
}

(async () => {
  const args    = process.argv.slice(2);
  const yi      = args.indexOf('--years');
  const years   = yi !== -1 ? Math.max(1, parseInt(args[yi + 1], 10) || 5) : 5;
  const named   = args.filter(a => !a.startsWith('--') && isNaN(parseFloat(a))).map(s => s.toUpperCase());
  const symbols = named.length ? named : DEFAULT_SYMBOLS;

  console.log(`\n══ HISTORICAL BACKFILL — Yahoo Finance, ${years}y daily ══`);
  console.log(`   ${symbols.length} symbols: ${symbols.join(', ')}\n`);

  let okCount = 0;
  for (const sym of symbols) {
    try {
      const rows = await fetchYahooDaily(sym, years);
      if (rows.length < 60) {
        console.log(`  ⚠  ${sym}: only ${rows.length} bars from Yahoo — skipped (signals need 60+)`);
        continue;
      }
      // Chunked insert — a 5y series is ~1,240 rows, and one giant multi-row
      // INSERT can exceed packet limits on managed MySQL.
      for (let i = 0; i < rows.length; i += 200) {
        await dataStore.saveDailyPrices(rows.slice(i, i + 200));
      }
      okCount++;
      console.log(`  ✅ ${sym}: ${rows.length} bars (${rows[0].date} → ${rows[rows.length - 1].date})`);
    } catch (e) {
      console.log(`  ❌ ${sym}: ${e.message}`);
    }
    await sleep(600);   // stay polite with Yahoo
  }

  // Verify what the DB actually holds now — trust the query, not the loop.
  console.log('\n── Verification (rows in daily_prices) ──');
  for (const sym of symbols) {
    try {
      const [r] = await db.query(
        'SELECT COUNT(*) AS n, MIN(trade_date) AS lo, MAX(trade_date) AS hi FROM daily_prices WHERE symbol = ?', [sym]);
      const { n, lo, hi } = r[0];
      const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
      console.log(`   ${sym.padEnd(12)} ${String(n).padStart(5)} rows  ${fmt(lo)} → ${fmt(hi)}`);
    } catch (_) {}
  }

  console.log(`\n${okCount}/${symbols.length} symbols backfilled. Signals compute once a symbol has 60+ bars.\n`);
  try { await db.closePool?.(); } catch (_) {}
  process.exit(0);
})().catch(e => { console.error(e.stack); process.exit(1); });
