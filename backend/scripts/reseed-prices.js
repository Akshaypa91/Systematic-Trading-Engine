// scripts/reseed-prices.js — RETIRED. Use scripts/backfill-history.js instead.
//
// This script used to fill daily_prices with a GENERATED random walk labelled
// "realistic NSE-like data". That was survivable when stored prices were only
// demo dressing; it is poison now that the engine treats stored closes as
// ground truth — LAST_CLOSE signal prices, indicator values, backtests, and the
// auto paper trader would all silently compute on invented numbers that nothing
// on screen could distinguish from real ones.
//
// backfill-history.js loads real Yahoo Finance OHLCV for the same symbols and
// is idempotent. There is no legitimate reason left to run this one, so it
// refuses:
'use strict';
console.error(
  '\n  reseed-prices.js is retired: it seeded FAKE generated prices into daily_prices.\n' +
  '  The engine now trusts stored closes as real market data, so seeding fakes\n' +
  '  would poison signals, backtests and the paper trader at once.\n\n' +
  '  Use instead:  node scripts/backfill-history.js   (real Yahoo Finance OHLCV)\n'
);
process.exit(1);
