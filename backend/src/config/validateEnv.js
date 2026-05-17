// src/config/validateEnv.js
// Add: require('./config/validateEnv')() at very top of app.js
'use strict';

const REQUIRED = [
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET',
];

const RECOMMENDED = [
  'UPSTOX_API_KEY', 'GOOGLE_CLIENT_ID', 'REDIS_URL',
  'RESEND_API_KEY', 'ALLOWED_ORIGINS', 'FRONTEND_URL',
];

module.exports = function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Missing required env vars:\n  ${missing.join('\n  ')}\n`);
    process.exit(1);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET too short — use at least 32 random characters');
    process.exit(1);
  }
  const warn = RECOMMENDED.filter(k => !process.env[k]);
  if (warn.length) console.warn(`⚠️  Missing recommended env: ${warn.join(', ')}`);
  console.log('✅ Environment validated');
};
