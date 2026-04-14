// scripts/testPortfolio.js
// ─────────────────────────────────────────────────────────────────────────────
// Manual smoke-test for portfolioState.js — no test runner needed.
// Run: node scripts/testPortfolio.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// Adjust path if running from project root
const portfolio = require('../src/portfolio/portfolioState');

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Test 1: Initial state ─────────────────────────────────────────────────────
section('Initial State');
const init = portfolio.getState();
assert('capital = 100000',         init.capital === 100000);
assert('positions = {}',           Object.keys(init.positions).length === 0);
assert('trades = []',              init.trades.length === 0);

// ── Test 2: BUY ───────────────────────────────────────────────────────────────
section('BUY 10 × INFY @ 1620');
const buy1 = portfolio.executeBuy('INFY', 10, 1620);
assert('trade action = BUY',       buy1.trade.action === 'BUY');
assert('trade qty = 10',           buy1.trade.qty === 10);
assert('trade price = 1620',       buy1.trade.price === 1620);
assert('capital deducted',         buy1.capital === 100000 - 10 * 1620);
assert('position created',         buy1.position.qty === 10);
assert('entryPrice correct',       buy1.position.entryPrice === 1620);

const s1 = portfolio.getState();
assert('state reflects BUY',       s1.positions['INFY'] !== undefined);
assert('1 trade recorded',         s1.trades.length === 1);

// ── Test 3: BUY more same symbol (average up) ─────────────────────────────────
section('BUY 5 more × INFY @ 1700 (avg-up)');
const buy2 = portfolio.executeBuy('INFY', 5, 1700);
assert('qty = 15',                 buy2.position.qty === 15);
const expectedAvg = ((10 * 1620) + (5 * 1700)) / 15;
assert('avg entry price correct',  buy2.position.entryPrice === parseFloat(expectedAvg.toFixed(2)));

// ── Test 4: Insufficient capital ──────────────────────────────────────────────
section('BUY exceeds capital → 400');
try {
  portfolio.executeBuy('RELIANCE', 1000000, 2850);
  assert('should have thrown',     false);
} catch (err) {
  assert('statusCode = 400',       err.statusCode === 400);
  assert('error mentions capital', err.message.includes('Insufficient capital'));
}

// ── Test 5: SELL partial ──────────────────────────────────────────────────────
section('SELL 5 × INFY @ 1750 (partial)');
const capitalBefore = portfolio.getState().capital;
const sell1 = portfolio.executeSell('INFY', 5, 1750);
assert('pnl calculated',           sell1.pnl !== null);
assert('position qty = 10',        sell1.position.qty === 10);
assert('capital increased',        portfolio.getState().capital > capitalBefore);

// ── Test 6: SELL full position ────────────────────────────────────────────────
section('SELL remaining 10 × INFY @ 1800 (close)');
const sell2 = portfolio.executeSell('INFY', 10, 1800);
assert('position removed',         sell2.position === null);
assert('INFY gone from state',     portfolio.getState().positions['INFY'] === undefined);

// ── Test 7: SELL no position → 400 ───────────────────────────────────────────
section('SELL non-existent position → 400');
try {
  portfolio.executeSell('TCS', 1, 4200);
  assert('should have thrown',     false);
} catch (err) {
  assert('statusCode = 400',       err.statusCode === 400);
  assert('error mentions symbol',  err.message.includes('TCS'));
}

// ── Test 8: SELL more than held → 400 ────────────────────────────────────────
section('SELL more than held → 400');
portfolio.executeBuy('WIPRO', 5, 560);
try {
  portfolio.executeSell('WIPRO', 100, 560);
  assert('should have thrown',     false);
} catch (err) {
  assert('statusCode = 400',       err.statusCode === 400);
}

// ── Test 9: reset ─────────────────────────────────────────────────────────────
section('reset()');
portfolio.reset();
const reset = portfolio.getState();
assert('capital back to 100000',   reset.capital === 100000);
assert('positions cleared',        Object.keys(reset.positions).length === 0);
assert('trades cleared',           reset.trades.length === 0);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('🎉 All tests passed!');
} else {
  console.error('⚠️  Some tests failed — see above.');
  process.exit(1);
}