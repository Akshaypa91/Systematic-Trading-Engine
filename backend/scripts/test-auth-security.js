// scripts/test-auth-security.js
// Regression tests for auth security invariants. Offline (db/email stubbed).
//   node scripts/test-auth-security.js
//
// Guards the account-takeover bug found in the 2026-07 live audit: the
// forgot-password endpoint returned a valid reset token in the HTTP response
// whenever email delivery failed AND NODE_ENV !== 'production'. A deployed
// instance with NODE_ENV unset therefore leaked reset tokens to anonymous
// callers. Security must not depend on NODE_ENV being set correctly.
'use strict';

const logger = require('../src/config/logger');
logger.info = () => {}; logger.warn = () => {}; logger.error = () => {};

const db = require('../src/config/database');
db.query = async (sql) => {
  const s = String(sql);
  if (s.includes('SELECT id FROM users')) return [[{ id: 1 }]];
  return [[], { insertId: 1 }];
};

// Force email delivery to "not sent" — the dangerous branch.
const emailService = require('../src/services/emailService');
emailService.sendPasswordReset = async () => ({ success: true, dev: true });

const auth = require('../src/controllers/authController');

function mockRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
const req = (email) => ({ body: { email }, headers: {}, ip: '1.2.3.4' });

let pass = 0, fail = 0;
const ok = (n, c, x = '') => c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x}`));

(async () => {
  console.log('forgot-password — reset token must never leak');

  // 1. NODE_ENV unset (the live misconfiguration) → must NOT leak.
  delete process.env.NODE_ENV;
  delete process.env.ALLOW_DEV_RESET_TOKEN;
  let res = mockRes();
  await auth.forgotPassword(req('victim@example.com'), res);
  ok('NODE_ENV unset → no _devToken in response', !res.body?._devToken, JSON.stringify(res.body));

  // 2. NODE_ENV=development → must NOT leak (this was the bug).
  process.env.NODE_ENV = 'development';
  res = mockRes();
  await auth.forgotPassword(req('victim@example.com'), res);
  ok('NODE_ENV=development → no _devToken', !res.body?._devToken, JSON.stringify(res.body));

  // 3. NODE_ENV=production → must NOT leak.
  process.env.NODE_ENV = 'production';
  res = mockRes();
  await auth.forgotPassword(req('victim@example.com'), res);
  ok('NODE_ENV=production → no _devToken', !res.body?._devToken, JSON.stringify(res.body));

  // 4. Response is always the same generic message (no user enumeration).
  ok('generic success message returned', res.body?.success === true && /if that email exists/i.test(res.body?.message || ''), JSON.stringify(res.body));

  // 5. Explicit local opt-in is the ONLY way to get the token.
  process.env.ALLOW_DEV_RESET_TOKEN = 'true';
  res = mockRes();
  await auth.forgotPassword(req('me@example.com'), res);
  ok('ALLOW_DEV_RESET_TOKEN=true → token returned (local dev only)', !!res.body?._devToken);
  delete process.env.ALLOW_DEV_RESET_TOKEN;

  // 6. Unknown email still returns the same generic response.
  db.query = async (sql) => String(sql).includes('SELECT id FROM users') ? [[]] : [[], {}];
  res = mockRes();
  await auth.forgotPassword(req('nobody@example.com'), res);
  ok('unknown email → same generic response, no token', res.body?.success === true && !res.body?._devToken);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack); process.exit(1); });
