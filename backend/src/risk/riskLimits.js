// src/risk/riskLimits.js — Phase 3
// User-configurable LIVE risk limits, persisted in system_flags (no new table).
// Keys: risk.daily_loss_limit, risk.max_exposure, risk.max_position_size,
//       risk.max_orders_per_day
'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

const KEYS = {
  dailyLossLimit:   'risk.daily_loss_limit',
  maxExposure:      'risk.max_exposure',
  maxPositionSize:  'risk.max_position_size',
  maxOrdersPerDay:  'risk.max_orders_per_day',
};

const DEFAULTS = {
  dailyLossLimit:  parseFloat(process.env.LIVE_DAILY_LOSS_LIMIT  || '25000'),
  maxExposure:     parseFloat(process.env.LIVE_MAX_EXPOSURE      || '1000000'),
  maxPositionSize: parseFloat(process.env.LIVE_MAX_POSITION_SIZE || '200000'),
  maxOrdersPerDay: parseInt(process.env.LIVE_MAX_ORDERS_PER_DAY  || '50', 10),
};

async function getLimits() {
  const out = { ...DEFAULTS };
  try {
    const [rows] = await db.query(
      `SELECT flag_key, flag_value FROM system_flags WHERE flag_key IN (?, ?, ?, ?)`,
      Object.values(KEYS)
    );
    const map = Object.fromEntries(rows.map(r => [r.flag_key, r.flag_value]));
    for (const [field, key] of Object.entries(KEYS)) {
      if (map[key] != null && map[key] !== '') {
        const n = Number(map[key]);
        if (Number.isFinite(n)) out[field] = n;
      }
    }
  } catch (err) {
    logger.warn(`[RiskLimits] read failed, using defaults: ${err.message}`);
  }
  return out;
}

async function setLimits(patch = {}) {
  const entries = Object.entries(KEYS).filter(([field]) => patch[field] != null);
  for (const [field, key] of entries) {
    const val = String(Number(patch[field]));
    await db.query(
      `INSERT INTO system_flags (flag_key, flag_value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value), updated_at = CURRENT_TIMESTAMP`,
      [key, val]
    );
  }
  return getLimits();
}

module.exports = { getLimits, setLimits, DEFAULTS };
