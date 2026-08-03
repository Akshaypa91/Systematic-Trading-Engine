// scripts/test-kill-switch.js — kill-switch semantics. Offline, no DB.
//   node scripts/test-kill-switch.js
//
// The bug this pins: the service function was called `setKillSwitch(enabled)`
// but its argument meant "live trading enabled", so `setKillSwitch(false)`
// ENGAGED the kill switch. All six call sites carried a trailing comment
// explaining the inversion — "false = live trading DISABLED (kill engaged)" —
// which is the clearest possible sign the name was wrong.
//
// On a path that decides whether real orders reach a broker, a reader who
// assumed `setKillSwitch(true)` meant "turn the kill switch ON" would have
// resumed trading instead of halting it. Renamed to setLiveTradingEnabled();
// these tests make sure the meaning cannot drift back.
'use strict';

const fs   = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));
const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('\nthe inverted name is gone');
{
  const svc = src('src/services/liveTradingService.js');
  ok('service exports setLiveTradingEnabled', /async function setLiveTradingEnabled\(enabled\)/.test(svc));
  ok('setLiveTradingEnabled is exported',     /\bsetLiveTradingEnabled\b/.test(svc.split('module.exports')[1] || ''));
  // The old name may survive only inside the explanatory comment.
  const code = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('no setKillSwitch left in service code', !/setKillSwitch/.test(code));
}

console.log('\nthe flag maps the right way round');
{
  const svc = src('src/services/liveTradingService.js');
  // enabled -> 'true'  |  !enabled -> 'false'. A flipped ternary here would
  // silently invert every safety halt in the system.
  ok("writes 'true' when enabled",  /\[enabled \? 'true' : 'false'\]/.test(svc));
  ok('reads live_trading_enabled',  /flag_key = 'live_trading_enabled'/.test(svc));
  // Reader must treat anything other than the literal 'false' as enabled, so a
  // missing row fails OPEN for reads but the writer is always explicit.
  ok("reader compares against 'false'", /flag_value !== 'false'/.test(svc));
}

console.log('\nevery safety halt disables trading (passes false)');
{
  const eng  = src('src/engine/liveExecutionEngine.js');
  const ctrl = src('src/controllers/liveController.js');

  ok('daily-loss halt disables',  /setLiveTradingEnabled\(false\)/.test(eng));
  ok('dead-man switch disables',  (eng.match(/setLiveTradingEnabled\(false\)/g) || []).length >= 2,
     String((eng.match(/setLiveTradingEnabled\(false\)/g) || []).length));
  ok('emergency stop disables',   /setLiveTradingEnabled\(false\)/.test(ctrl));

  // No safety path may ever call it with `true` — that would resume trading at
  // the exact moment the system decided to stop.
  const halts = eng.match(/setLiveTradingEnabled\((true|!.*?)\)/g) || [];
  ok('execution engine never enables trading', halts.length === 0, halts.join(','));
}

console.log('\ncontroller translates kill-switch language exactly once');
{
  const ctrl = src('src/controllers/liveController.js');
  // POST /api/live/kill-switch takes {engaged}; the service takes {enabled}.
  ok('user endpoint inverts engaged -> enabled', /setLiveTradingEnabled\(!engaged\)/.test(ctrl));

  // The admin endpoint historically took the OPPOSITE boolean under the same
  // "kill switch" name. It must now accept `engaged` and only fall back to the
  // legacy `enabled` key.
  ok('admin endpoint prefers engaged', /hasOwnProperty\.call\(body, 'engaged'\)/.test(ctrl));
  ok('admin endpoint still honours legacy enabled', /!body\.enabled/.test(ctrl));
  ok('admin endpoint reports both fields', /killSwitch: halted, liveEnabled: !halted/.test(ctrl));
}

console.log('\nblocked orders return a machine-readable code');
{
  const svc = src('src/services/liveTradingService.js');
  // The UI keys its guidance off `code`, so a rejection without one degrades to
  // a bare status number — which is how a 503 read as "nothing happened".
  const guards = ['KILL_SWITCH', 'MARKET_CLOSED', 'CONFIRMATION_REQUIRED', 'QTY_LIMIT'];
  for (const g of guards) ok(`${g} carries a code`, new RegExp(`code: '${g}'`).test(svc));
  ok('kill switch returns 503', /code: 'KILL_SWITCH'[^}]*statusCode: 503/.test(svc));
}

console.log('\nUI has guidance for every backend rejection code');
{
  const svc  = src('src/services/liveTradingService.js');
  const modal = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/components/LiveOrderModal.jsx'), 'utf8');
  const codes = [...new Set((svc.match(/code: '([A-Z_]+)'/g) || []).map(m => m.slice(7, -1)))];
  ok('backend defines rejection codes', codes.length >= 4, String(codes.length));
  const missing = codes.filter(c => !modal.includes(c));
  ok('every backend code has UI guidance', missing.length === 0, missing.join(', '));

  // And the reverse: a help entry keyed on a code nothing throws is dead text
  // that can never render. The first version of the map had five such keys.
  const helpKeys = [...(modal.match(/^\s{2}([A-Z_]+):\s+'/gm) || [])].map(m => m.trim().split(':')[0]);
  const uiOnly = helpKeys.filter(k => !codes.includes(k) && !['BROKER_NOT_CONNECTED', 'BROKER_NOT_YOURS'].includes(k));
  ok('no help entry for a code nothing throws', uiOnly.length === 0, uiOnly.join(', '));
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
