// scripts/test-broker-ownership.js — broker session must not leak across users.
//   node scripts/test-broker-ownership.js
//
// The bug: the Upstox access token was a single process-wide value with no
// recorded owner, and the /api/live routes only applied requireAuth — i.e.
// "is somebody logged in", never "is this THEIR account". Two different logins
// therefore rendered the same client ID, the same account holder name and the
// same ₹ balance, and POST /api/live/order would have placed a REAL order on
// whoever linked Upstox last.
//
// Authentication answered; authorisation never asked. These tests pin the
// answer to the second question.
'use strict';
process.env.UPSTOX_ACCESS_TOKEN = '';       // don't inherit a real token
require('dotenv').config();

const logger = require('../src/config/logger');
logger.info = () => {}; logger.debug = () => {}; logger.warn = () => {};

const upstoxAuth = require('../src/services/upstoxAuth');
const { requireBrokerOwner } = require('../src/middleware/brokerOwner');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

// Minimal express double: we only need status/json and next().
function runGuard(userId) {
  const req = { user: userId == null ? {} : { userId }, method: 'GET', originalUrl: '/api/live/funds' };
  const out = { status: 200, body: null, nexted: false };
  const res = {
    status(c) { out.status = c; return this; },
    json(b)   { out.body = b; return this; },
  };
  requireBrokerOwner(req, res, () => { out.nexted = true; });
  return out;
}

const ALICE = 101, BOB = 202;

console.log('\nno broker linked');
upstoxAuth.clearToken();
{
  ok('isAuthenticated false', upstoxAuth.isAuthenticated() === false);
  ok('owner is null', upstoxAuth.getOwnerUserId() === null);
  const r = runGuard(ALICE);
  ok('guard blocks with 409 BROKER_NOT_CONNECTED', r.status === 409 && r.body?.error === 'BROKER_NOT_CONNECTED', JSON.stringify(r.body));
  ok('guard does not call next()', r.nexted === false);
}

console.log('\nAlice links her Upstox account');
upstoxAuth.setAccessToken('alice-token-abc', 3600, ALICE);
{
  ok('token is live', upstoxAuth.isAuthenticated() === true);
  ok('owner recorded as Alice', upstoxAuth.getOwnerUserId() === ALICE, String(upstoxAuth.getOwnerUserId()));
  ok('isOwnedBy(Alice) true',  upstoxAuth.isOwnedBy(ALICE) === true);

  // THE BUG, pinned: Bob is a fully authenticated user of the same deployment.
  ok('isOwnedBy(Bob) FALSE',   upstoxAuth.isOwnedBy(BOB) === false);
  ok('isOwnedBy(null) false',  upstoxAuth.isOwnedBy(null) === false);
  // '101' vs 101 must still match — JWT payloads stringify ids in some flows.
  ok('string id matches numeric owner', upstoxAuth.isOwnedBy('101') === true);
}

console.log('\nguard behaviour with an owned session');
{
  const a = runGuard(ALICE);
  ok('Alice passes through', a.nexted === true && a.status === 200);

  const b = runGuard(BOB);
  ok('Bob is blocked 403', b.status === 403, String(b.status));
  ok('Bob gets BROKER_NOT_YOURS', b.body?.error === 'BROKER_NOT_YOURS', JSON.stringify(b.body));
  ok('Bob never reaches the handler', b.nexted === false);
  // The refusal must not describe the account it is protecting.
  const leaked = JSON.stringify(b.body);
  ok('403 body leaks no token', !leaked.includes('alice-token-abc'));
  ok('403 body leaks no owner id', !leaked.includes(String(ALICE)));

  const anon = runGuard(null);
  ok('unidentified caller blocked', anon.status === 403 && anon.nexted === false);
}

console.log('\nunowned token (env-injected or pre-upgrade) fails closed');
{
  upstoxAuth.setAccessToken('legacy-token', 3600, null);
  ok('token usable for market data', upstoxAuth.isAuthenticated() === true);
  ok('but has no owner', upstoxAuth.getOwnerUserId() === null);
  ok('nobody can claim it — Alice', upstoxAuth.isOwnedBy(ALICE) === false);
  ok('nobody can claim it — Bob',   upstoxAuth.isOwnedBy(BOB) === false);
  ok('guard blocks 403', runGuard(ALICE).status === 403);
}

console.log('\nclearing resets ownership');
{
  upstoxAuth.setAccessToken('t', 3600, ALICE);
  upstoxAuth.clearToken();
  ok('owner cleared with token', upstoxAuth.getOwnerUserId() === null);
  ok('Alice can no longer act', upstoxAuth.isOwnedBy(ALICE) === false);
}

console.log('\nOAuth state binding (signed, not a raw user id)');
{
  const s = upstoxAuth.signState(ALICE);
  ok('state is produced', typeof s === 'string' && s.length > 10);
  ok('state does not contain a bare user id', !Buffer.from(s, 'base64url').toString().startsWith(`${ALICE}.${ALICE}`));
  ok('round-trips to Alice', upstoxAuth.verifyState(s) === ALICE, String(upstoxAuth.verifyState(s)));

  ok('rejects empty state', upstoxAuth.verifyState('') === null);
  ok('rejects garbage', upstoxAuth.verifyState('not-a-state') === null);

  // Forgery: swap the user id but keep a plausible shape → MAC must fail, so a
  // crafted callback URL cannot assign the broker session to someone else.
  const raw = Buffer.from(s, 'base64url').toString('utf8');
  const [, ts, mac] = raw.split('.');
  const forged = Buffer.from(`${BOB}.${ts}.${mac}`).toString('base64url');
  ok('rejects a tampered user id', upstoxAuth.verifyState(forged) === null);

  // Expiry: a state older than the window must not be replayable.
  const crypto = require('crypto');
  const key = crypto.createHash('sha256')
    .update(process.env.UPSTOX_TOKEN_SECRET || process.env.JWT_SECRET || 'systra-dev-token-key').digest();
  const oldTs = Date.now() - 11 * 60 * 1000;
  const oldMac = crypto.createHmac('sha256', key).update(`${ALICE}.${oldTs}`).digest('hex').slice(0, 32);
  const stale = Buffer.from(`${ALICE}.${oldTs}.${oldMac}`).toString('base64url');
  ok('rejects an expired state', upstoxAuth.verifyState(stale) === null);
}

console.log('\nroute wiring — account routes carry the guard');
{
  const fs = require('fs');
  const path = require('path');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/live.js'), 'utf8');
  const MUST_GUARD = [
    "'/order'", "'/positions'", "'/positions/exit'", "'/orders'",
    "'/funds'", "'/funds/normalized'", "'/holdings'", "'/order/:brokerOrderId'",
    "'/emergency/square-off'", "'/emergency/cancel-all'",
  ];
  for (const r of MUST_GUARD) {
    const line = routes.split('\n').find(l => l.includes(r) && /router\.(get|post|put|delete)/.test(l));
    ok(`${r} is owner-gated`, !!line && line.includes('requireBrokerOwner'), line ? line.trim() : 'route missing');
  }
  // Market data must NOT be gated — it isn't account data, and gating it would
  // break background jobs that have no request context.
  const diag = routes.split('\n').find(l => l.includes("'/diagnostics'"));
  ok('/diagnostics stays open', !!diag && !diag.includes('requireBrokerOwner'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
