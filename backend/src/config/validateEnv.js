// src/config/validateEnv.js
// Fail-fast startup validation for required configuration.
// Called once from src/app.js at boot, before the server starts listening.
'use strict';

// Kept in sync with what the app actually reads (see src/config/database.js,
// src/controllers/authController.js). Previously this list referenced
// DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME, which the app hasn't used
// since the move to a single DATABASE_URL connection string — fixed here.
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

const RECOMMENDED = [
  'UPSTOX_API_KEY', 'GOOGLE_CLIENT_ID', 'RESEND_API_KEY',
  'ALLOWED_ORIGINS', 'FRONTEND_URL',
];

// Known placeholder secrets that must never reach production.
const INSECURE_JWT_DEFAULTS = [
  'dev_secret_min_32_chars_please!!',
  'systra-secret-change-in-production',
];

/**
 * Validate critical environment configuration.
 *
 * In production: logs every problem, then exits the process rather than
 * booting with broken/insecure config.
 * In development: logs the same problems as warnings and continues, so
 * local dev isn't blocked by an incomplete .env.
 *
 * @param {{ logger?: Console }} opts
 * @returns {{ ok: boolean, problems: string[], warnings: string[] }}
 */
module.exports = function validateEnv({ logger = console } = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const problems = [];

  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    problems.push(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }
  if (process.env.JWT_SECRET && INSECURE_JWT_DEFAULTS.includes(process.env.JWT_SECRET)) {
    problems.push('JWT_SECRET is set to a known placeholder value — generate a real secret');
  }

  const warnings = RECOMMENDED.filter(k => !process.env[k]);

  if (problems.length) {
    problems.forEach(p => logger.error(`[Config] ❌ ${p}`));
    if (isProd) {
      logger.error('[Config] Refusing to start in production with invalid configuration.');
      process.exit(1);
    } else {
      logger.warn('[Config] ⚠️  Starting in development mode despite the above — fix before deploying.');
    }
  } else {
    logger.info('[Config] ✅ Environment validated');
  }

  if (warnings.length) {
    logger.warn(`[Config] ⚠️  Missing recommended env vars: ${warnings.join(', ')}`);
  }

  return { ok: problems.length === 0, problems, warnings };
};
