// scripts/migrate-portfolio.js
// Run: node scripts/migrate-portfolio.js
// Adds portfolios + sim_trades tables. Safe to re-run.
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db   = require('../src/config/database');
const fs   = require('fs');
const path = require('path');

async function run() {
  console.log('[Migrate] Running portfolio migration…');

  const sql = fs.readFileSync(
    path.join(__dirname, 'migrate-portfolio.sql'), 'utf8'
  );

  // Split on semicolons, filter blanks/comments
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await db.query(stmt);
      const label = stmt.slice(0, 60).replace(/\n/g, ' ');
      console.log(`  ✅ ${label}…`);
    } catch (err) {
      // Warn but continue — some stmts may already exist
      console.warn(`  ⚠️  ${err.message}`);
    }
  }

  console.log('[Migrate] Portfolio migration complete.');
  process.exit(0);
}

run().catch(err => {
  console.error('[Migrate] Fatal:', err.message);
  process.exit(1);
});