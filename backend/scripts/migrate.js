// scripts/migrate.js - runs CockroachDB/PostgreSQL schema initialisation
'use strict';
require('dotenv').config();
const db = require('../src/config/database');
const { initDB } = require('../src/config/initDB');

async function run() {
  await db.testConnection();
  const result = await initDB();
  if (result.failed.length) {
    throw new Error(`Schema migration failed for: ${result.failed.join(', ')}`);
  }
  console.log('[migrate] Schema applied successfully');
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
