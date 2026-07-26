// scripts/verify-upstox-ws.js
// ─────────────────────────────────────────────────────────────────────────────
// Verify the Upstox V3 market-data WebSocket + protobuf schema WITHOUT enabling
// UPSTOX_WS_ENABLED in production. Connects once with your existing token,
// subscribes to a few symbols, prints decoded ticks, and exits.
//
// READ-ONLY: subscribes to market data only. It cannot place, modify or cancel
// any order. Safe to run while live trading is armed.
//
//   node scripts/verify-upstox-ws.js                    # default symbols, 30s
//   node scripts/verify-upstox-ws.js RELIANCE TCS       # specific symbols
//   VERIFY_SECONDS=60 node scripts/verify-upstox-ws.js
//
// PASS  → ticks print with sane prices that match your Upstox app / the REST
//         feed. The protobuf field numbers are correct; you may enable
//         UPSTOX_WS_ENABLED=true.
// FAIL  → no ticks (check market hours / token) or garbled prices (schema
//         mismatch — do NOT enable the flag; the REST poller keeps working).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
require('dotenv').config();

const WebSocket   = require('ws');
const axios       = require('axios');
const upstoxAuth  = require('../src/services/upstoxAuth');
const upstoxProto = require('../src/ws/upstoxProto');
const symbols     = require('../src/config/symbols');
const logger      = require('../src/config/logger');

logger.info = () => {}; logger.debug = () => {};   // keep output clean

const AUTHORIZE_URL = 'https://api.upstox.com/v3/feed/market-data-feed/authorize';
const SECONDS = parseInt(process.env.VERIFY_SECONDS || '30', 10);
const DEFAULTS = ['RELIANCE', 'TCS', 'INFY'];

function istNow() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 19); }
function marketOpen() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const d = ist.getUTCDay(), hhmm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return d >= 1 && d <= 5 && hhmm >= 915 && hhmm <= 1530;
}

(async () => {
  const syms = process.argv.slice(2).length ? process.argv.slice(2).map(s => s.toUpperCase()) : DEFAULTS;
  console.log(`\n── Upstox WS verification ──  ${istNow()} IST`);
  console.log(`   symbols: ${syms.join(', ')}   duration: ${SECONDS}s`);

  if (!marketOpen()) {
    console.log('\n⚠  NSE is CLOSED. The socket may connect but few/no ticks will arrive,');
    console.log('   so you cannot verify prices now. Re-run during 09:15–15:30 IST, Mon–Fri.\n');
  }

  // ── Token source diagnosis ──────────────────────────────────────────────────
  // The live token lives ENCRYPTED in system_flags (key derived from
  // UPSTOX_TOKEN_SECRET || JWT_SECRET). If this machine's secret differs from the
  // server's, decryption fails silently and we'd fall back to a stale
  // UPSTOX_ACCESS_TOKEN in .env — which 401s. Report exactly what happened.
  const envToken = process.env.UPSTOX_ACCESS_TOKEN || null;
  let persistedRowExists = false;
  try {
    const dbc = require('../src/config/database');
    const [rows] = await dbc.query(`SELECT flag_value FROM system_flags WHERE flag_key = 'upstox.token_enc' LIMIT 1`);
    persistedRowExists = !!rows?.[0]?.flag_value;
  } catch (e) { console.log(`  (could not read persisted token: ${e.message.slice(0, 60)})`); }

  const loaded = await (upstoxAuth.loadPersistedToken?.() ?? Promise.resolve(false)).catch(() => false);
  const token = upstoxAuth.getAccessToken();
  if (!token) { console.error('✗ No Upstox token. Complete OAuth in the app first.\n'); process.exit(1); }

  const fp = `${token.slice(0, 6)}…${token.slice(-4)} (len ${token.length})`;
  const source = loaded ? 'persisted (DB, shared with server)' : (envToken ? 'local .env UPSTOX_ACCESS_TOKEN' : 'in-memory');
  console.log(`✓ token source: ${source}\n  fingerprint: ${fp}`);
  if (!loaded && persistedRowExists) {
    console.log('\n⚠  A persisted token EXISTS in the DB but could not be decrypted here.');
    console.log('   Your local UPSTOX_TOKEN_SECRET / JWT_SECRET differs from the server\'s,');
    console.log('   so this script fell back to a (likely stale) .env token.');
    console.log('   Fix: copy the server\'s UPSTOX_TOKEN_SECRET (or JWT_SECRET) into backend/.env,');
    console.log('   and remove any old UPSTOX_ACCESS_TOKEN line.\n');
  } else if (!loaded && envToken) {
    console.log('\n⚠  Using UPSTOX_ACCESS_TOKEN from .env — these go stale daily (~3:30am IST).');
    console.log('   If it 401s, reconnect Upstox in the app and re-run.\n');
  }

  const keys = syms.map(s => symbols.toUpstox(s)).filter(Boolean);
  if (!keys.length) { console.error('✗ Could not resolve any instrument keys.\n'); process.exit(1); }

  // 1. Authorize → one-time wss URI
  let uri;
  try {
    const res = await axios.get(AUTHORIZE_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeout: 15000,
    });
    uri = res.data?.data?.authorized_redirect_uri || res.data?.data?.authorizedRedirectUri;
    if (!uri) throw new Error('no authorized_redirect_uri in response');
    console.log('✓ authorize OK');
  } catch (e) {
    const st = e.response?.status;
    console.error(`✗ authorize failed${st ? ` (${st})` : ''}: ${e.message}`);
    if (st === 401 || st === 403) {
      console.error('  → This token was rejected by Upstox. Checklist:');
      console.error(`     1. Token used came from: ${source}.`);
      console.error('     2. If that is .env, it is probably stale — the SERVER may hold a good');
      console.error('        one (check /diagnostics: ticks flowing = server token is fine).');
      console.error('     3. Align secrets so this script reads the same token as the server, or');
      console.error('        re-run the Upstox OAuth login locally to mint a fresh one.');
    }
    process.exit(1);
  }

  // 2. Connect + subscribe (binary frame) + decode
  const ws = new WebSocket(uri, { handshakeTimeout: 15000 });
  let ticks = 0;
  const seen = new Map();   // symbol → last price

  const finish = (code) => {
    try { ws.close(); } catch (_) {}
    console.log(`\n── Result ──`);
    console.log(`   ticks decoded: ${ticks}`);
    if (ticks === 0) {
      console.log('   ✗ No ticks. If the market is open and the token is valid, the');
      console.log('     subscription or schema may be wrong — do NOT enable UPSTOX_WS_ENABLED.');
    } else {
      console.log('   last prices:');
      for (const [s, p] of seen) console.log(`     ${s.padEnd(12)} ₹${p}`);
      console.log('\n   ✓ Ticks decoded. COMPARE these against your Upstox app / the');
      console.log('     Diagnostics REST prices. If they match → safe to set');
      console.log('     UPSTOX_WS_ENABLED=true. If they look wrong → leave it off.');
    }
    console.log('');
    process.exit(code);
  };

  ws.on('open', () => {
    console.log('✓ socket open — subscribing…');
    ws.send(Buffer.from(JSON.stringify({
      guid: `verify-${Date.now()}`, method: 'sub',
      data: { mode: process.env.UPSTOX_WS_MODE || 'ltpc', instrumentKeys: keys },
    })));
  });

  ws.on('message', (raw) => {
    if (!Buffer.isBuffer(raw)) return;
    let decoded;
    try { decoded = upstoxProto.decode(raw); }
    catch (e) { console.log(`  ! decode failed: ${e.message}`); return; }
    for (const [key, t] of Object.entries(decoded.feeds || {})) {
      const sym = symbols.fromUpstox(key) || key;
      ticks++; seen.set(sym, t.ltp);
      if (ticks <= 20) console.log(`  ${istNow()}  ${String(sym).padEnd(12)} ₹${t.ltp}  (${t.changePct >= 0 ? '+' : ''}${t.changePct}%)`);
    }
  });

  ws.on('error', (e) => { console.error(`✗ socket error: ${e.message}`); finish(1); });
  ws.on('close', (c) => { console.log(`  socket closed (${c})`); });

  setTimeout(() => finish(ticks > 0 ? 0 : 1), SECONDS * 1000);
})();
