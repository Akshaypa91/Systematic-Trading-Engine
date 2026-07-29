// src/config/logger.js — Production Logger
// ─────────────────────────────────────────────────────────────────────────────
// Five log streams:
//   app.log        — all INFO+ (rotates at 10MB, keeps 7 files)
//   error.log      — ERROR only
//   trades.log     — structured trade records (BUY/SELL/REJECT/COOLDOWN)
//   signals.log    — structured signal records
//   exceptions.log — uncaught exceptions
//
// Console: JSON in production, coloured pretty-print in development.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { createLogger, format, transports, addColors } = require('winston');
const path = require('path');
const fs   = require('fs');

// Default to 'info' regardless of NODE_ENV. Deriving this from NODE_ENV meant a
// deployed instance with NODE_ENV unset (Render defaults to "development") ran
// at debug level, flooding production logs with per-symbol provider chatter.
// Verbose logging is now an explicit opt-in: LOG_LEVEL=debug.
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR   = process.env.LOG_DIR   || path.join(process.cwd(), 'logs');

// Ensure log directory exists at module load (sync is fine — this runs once)
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Custom levels (adds 'http' between info and debug) ───────────────────────
addColors({ http: 'magenta' });

// ── Shared base format ────────────────────────────────────────────────────────
const baseFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.errors({ stack: true }),
  format.splat(),
);

// ── Console format ────────────────────────────────────────────────────────────
const consoleFormat = process.env.NODE_ENV === 'production'
  ? format.combine(baseFormat, format.json())
  : format.combine(
      baseFormat,
      format.colorize({ all: true }),
      format.printf(({ level, message, timestamp, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return stack
          ? `${timestamp} [${level}] ${message}\n${stack}${metaStr}`
          : `${timestamp} [${level}] ${message}${metaStr}`;
      }),
    );

// ── File rotation options ─────────────────────────────────────────────────────
const fileOpts = (filename) => ({
  filename: path.join(LOG_DIR, filename),
  format:   format.combine(baseFormat, format.json()),
  maxsize:  10 * 1024 * 1024,  // 10 MB
  maxFiles: 7,
  tailable: true,
});

// ── Main logger ───────────────────────────────────────────────────────────────
const logger = createLogger({
  levels: {
    error: 0, warn: 1, info: 2, http: 3, debug: 4, silly: 5,
  },
  level:  LOG_LEVEL,
  format: baseFormat,
  transports: [
    new transports.Console({ format: consoleFormat }),
    new transports.File(fileOpts('app.log')),
    new transports.File({ ...fileOpts('error.log'), level: 'error' }),
  ],
  exceptionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, 'rejections.log') }),
  ],
});

// ── Trade logger (separate file for audit trail) ─────────────────────────────
const tradeLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.json(),
  ),
  transports: [
    new transports.File(fileOpts('trades.log')),
  ],
});

// ── Signal logger (separate file) ────────────────────────────────────────────
const signalLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.json(),
  ),
  transports: [
    new transports.File(fileOpts('signals.log')),
  ],
});

// ── Convenience methods ───────────────────────────────────────────────────────

/**
 * Log a structured trade event.
 * @param {string} event  e.g. 'ORDER_PLACED', 'ORDER_REJECTED', 'STOP_LOSS'
 * @param {Object} data
 */
logger.logTrade = (event, data = {}) => {
  const record = { event, ts: new Date().toISOString(), ...data };
  tradeLogger.info(record);
  logger.info(`[Trade:${event}] ${data.symbol || ''} ${data.side || ''} ${data.quantity || ''} @₹${data.fillPrice || data.executedPrice || ''}`);
};

/**
 * Log a structured signal event.
 * @param {string} event  e.g. 'SIGNAL_GENERATED', 'SIGNAL_SKIPPED'
 * @param {Object} data
 */
logger.logSignal = (event, data = {}) => {
  const record = { event, ts: new Date().toISOString(), ...data };
  signalLogger.info(record);
  if (data.signal !== 'HOLD') {
    logger.info(`[Signal:${event}] ${data.symbol || ''} ${data.signal || ''} conf=${typeof data.confidence === 'number' ? data.confidence.toFixed(3) : (data.confidence || 'N/A')}`);
  }
};

/**
 * Log an error with context.
 */
logger.logError = (context, err, meta = {}) => {
  logger.error(`[${context}] ${err.message}`, { context, error: err.message, stack: err.stack, ...meta });
};

module.exports = logger;
