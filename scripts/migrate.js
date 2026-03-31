// scripts/migrate.js — runs schema.sql against the configured DB
'use strict';
require('dotenv').config();
const fs  = require('fs');
const path = require('path');
const db  = require('../src/config/database');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname,'schema.sql'), 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  await db.testConnection();
  for (const stmt of statements) {
    try { await db.query(stmt); }
    catch (e) { if (!e.message.includes('already exists')) throw e; }
  }
  console.log('[migrate] Schema applied successfully');
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
