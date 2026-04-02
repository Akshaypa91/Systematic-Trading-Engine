// scripts/run-sample-backtest.js
// Runs a backtest on all seeded symbols and prints a comparison table.
// Requires: database running + seed data loaded (npm run db:seed)

'use strict';

require('dotenv').config();

const dataStore  = require('../src/data/dataStore');
const backtester = require('../src/engine/backtester');
const C          = require('../src/config/constants');
const logger     = require('../src/config/logger');

const SYMBOLS    = ['RELIANCE','INFY','HDFCBANK','TCS','WIPRO','ICICIBANK'];
const STRATEGIES = ['MEAN_REVERSION', 'MA_CROSSOVER', 'RSI', 'AGGREGATED'];

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          SYSTEMATIC TRADING ENGINE — BACKTEST REPORT         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const allResults = [];

  for (const symbol of SYMBOLS) {
    const prices = await dataStore.getDailyPrices(symbol);
    if (!prices || prices.length < 202) {
      console.log(`⚠️  ${symbol}: insufficient data (${prices?.length ?? 0} bars) — run npm run db:seed\n`);
      continue;
    }

    console.log(`\n📊 ${symbol} | ${prices.length} bars | ${prices[0].date} → ${prices[prices.length - 1].date}`);
    console.log('─'.repeat(95));
    console.log(
      'Strategy'.padEnd(20),
      'Return%'.padStart(10),
      'Annual%'.padStart(10),
      'Sharpe'.padStart(8),
      'MaxDD%'.padStart(8),
      'WinRate%'.padStart(10),
      'Trades'.padStart(8),
      'ProfFactor'.padStart(12),
    );
    console.log('─'.repeat(95));

    for (const strategy of STRATEGIES) {
      try {
        const { summary } = backtester.runBacktest({
          symbol,
          prices,
          initialCapital: C.BACKTEST.DEFAULT_CAPITAL,
          strategy,
        });

        const row = [
          strategy.padEnd(20),
          `${summary.totalReturnPct >= 0 ? '+' : ''}${summary.totalReturnPct.toFixed(2)}%`.padStart(10),
          `${summary.annualisedReturnPct >= 0 ? '+' : ''}${summary.annualisedReturnPct.toFixed(2)}%`.padStart(10),
          (summary.sharpeRatio?.toFixed(3) ?? 'N/A').padStart(8),
          `${summary.maxDrawdownPct.toFixed(2)}%`.padStart(8),
          `${summary.winRatePct.toFixed(1)}%`.padStart(10),
          String(summary.totalTrades).padStart(8),
          (summary.profitFactor?.toFixed(3) ?? 'N/A').padStart(12),
        ].join(' ');

        console.log(row);
        allResults.push(summary);
      } catch (err) {
        console.log(`  ${strategy.padEnd(20)} ERROR: ${err.message}`);
      }
    }
  }

  // ── Overall winner ────────────────────────────────────────────────────────
  if (allResults.length > 0) {
    const best = allResults
      .filter(r => r.sharpeRatio !== null)
      .sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];

    if (best) {
      console.log('\n\n🏆 Best Risk-Adjusted Result (by Sharpe Ratio):');
      console.log(`   Symbol:   ${best.symbol}`);
      console.log(`   Strategy: ${best.strategy}`);
      console.log(`   Return:   ${best.totalReturnPct.toFixed(2)}%`);
      console.log(`   Sharpe:   ${best.sharpeRatio.toFixed(3)}`);
      console.log(`   Max DD:   ${best.maxDrawdownPct.toFixed(2)}%`);
    }
  }

  console.log('\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Backtest script failed:', err.message);
  process.exit(1);
});
