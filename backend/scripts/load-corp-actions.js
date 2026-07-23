// scripts/load-corp-actions.js
// Pull corporate actions (splits/bonuses) from NSE into the corporate_actions
// table. Run after migrate-corp-actions.sql.
//   node scripts/load-corp-actions.js RELIANCE INFY TCS
//   node scripts/load-corp-actions.js            # defaults to a NIFTY-ish set
'use strict';
require('dotenv').config();
const db = require('../src/config/database');
const loader = require('../src/data/corpActionLoader');

const DEFAULT = ['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','SBIN','ITC','LT','AXISBANK','TATASTEEL'];

(async () => {
  const symbols = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  await db.testConnection();
  console.log(`[load-corp-actions] loading ${symbols.length} symbol(s)…`);
  const results = await loader.loadMany(symbols);
  let saved = 0;
  for (const r of results) {
    saved += r.saved || 0;
    console.log(`  ${r.symbol.padEnd(12)} fetched=${r.fetched} parsed=${r.parsed} saved=${r.saved}${r.error ? ' ERROR: ' + r.error : ''}`);
  }
  console.log(`[load-corp-actions] done — ${saved} action(s) saved`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
