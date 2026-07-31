// scripts/ci-tests.js — offline CI gate. No DB / network required.
//   1. Syntax-checks every .js under src/ (node --check)
//   2. Runs the offline unit-test scripts and aggregates results
// Exit non-zero on any failure so CI blocks the merge.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// ── 1. Syntax check every source file ─────────────────────────────────────────
console.log('▶ node --check src/**/*.js');
let checked = 0;
for (const f of walk(path.join(ROOT, 'src'))) {
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); checked++; }
  catch (e) { failures++; console.log(`  ❌ syntax: ${path.relative(ROOT, f)}\n${e.stderr?.toString() || e.message}`); }
}
console.log(`  ${checked} files OK\n`);

// ── 2. Run offline unit-test scripts ──────────────────────────────────────────
const SUITES = [
  'scripts/test-corp-actions.js',
  'scripts/test-corp-loader.js',
  'scripts/test-strategy-parity.js',
  'scripts/test-live-order-risk.js',
  'scripts/test-upstox-proto.js',
  'scripts/test-execution-quality.js',
  'scripts/test-order-lifecycle.js',
  'scripts/test-live-execution.js',
  'scripts/test-position-exit.js',
  'scripts/test-manage-exits.js',
  'scripts/test-auto-entries.js',
  'scripts/test-position-sizing.js',
  'scripts/test-entry-sizing.js',
  'scripts/test-execution-algos.js',
  'scripts/test-order-slicing.js',
  'scripts/test-portfolio-backtest.js',
  'scripts/test-auth-security.js',
  'scripts/test-symbol-resolution.js',
  'scripts/test-cross-exchange-spread.js',
  'scripts/test-latency-monitor.js',
  'scripts/test-datastore-adjust.js',
  'scripts/test-intraday-scalper.js',
  'scripts/test-no-fake-prices.js',
  'scripts/test-broker-ownership.js',
  'scripts/test-swing-outcomes.js',
];
for (const s of SUITES) {
  const p = path.join(ROOT, s);
  if (!fs.existsSync(p)) { console.log(`▶ ${s} — SKIP (missing)\n`); continue; }
  console.log(`▶ ${s}`);
  try {
    const out = execSync(`node "${p}"`, { stdio: 'pipe' }).toString();
    console.log(out.trim().split('\n').map(l => '  ' + l).join('\n') + '\n');
  } catch (e) {
    failures++;
    console.log((e.stdout?.toString() || e.message).trim().split('\n').map(l => '  ' + l).join('\n'));
    console.log(`  ❌ suite failed: ${s}\n`);
  }
}

console.log(failures ? `\n✗ CI FAILED — ${failures} failure(s)` : '\n✓ CI PASSED');
process.exit(failures ? 1 : 0);
