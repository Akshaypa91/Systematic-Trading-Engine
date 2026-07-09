// scripts/run-sql.js — apply a .sql file through the app's TiDB connection.
// Usage:  node scripts/run-sql.js scripts/migrate-live-orders-phase2.sql
// Splits on ';', runs each statement, and treats "duplicate column" as OK so
// the migration is safe to re-run.
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');

const IGNORABLE = /duplicate column|already exists|1060|check that column/i;

async function run() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/run-sql.js <path-to.sql>'); process.exit(1); }

  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.replace(/^\s*--.*$/gm, '').trim())   // strip line comments
    .filter(Boolean);

  await db.testConnection();
  console.log(`[run-sql] applying ${statements.length} statement(s) from ${file}`);

  let ok = 0, skipped = 0;
  for (const stmt of statements) {
    try {
      await db.query(stmt);
      ok++;
      console.log(`  ✅ ${stmt.slice(0, 70).replace(/\s+/g, ' ')}…`);
    } catch (err) {
      if (IGNORABLE.test(err.message)) {
        skipped++;
        console.log(`  ⏭️  already applied — ${stmt.slice(0, 50).replace(/\s+/g, ' ')}…`);
      } else {
        console.error(`  ❌ ${err.message}\n     in: ${stmt.slice(0, 120)}`);
        process.exit(1);
      }
    }
  }
  console.log(`[run-sql] done — ${ok} applied, ${skipped} already present`);
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
