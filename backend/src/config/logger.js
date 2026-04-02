// src/config/logger.js
// Structured logging with Winston — JSON in production, pretty-print in dev

'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_DIR   = path.join(process.cwd(), 'logs');

const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    format.splat(),
  ),
  transports: [
    // ── Console (pretty in dev, JSON in prod) ────────────────────────────────
    new transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? format.json()
        : format.combine(
            format.colorize(),
            format.printf(({ level, message, timestamp, stack }) =>
              stack
                ? `${timestamp} [${level}] ${message}\n${stack}`
                : `${timestamp} [${level}] ${message}`
            )
          ),
    }),
    // ── File: all logs ───────────────────────────────────────────────────────
    new transports.File({
      filename: path.join(LOG_DIR, 'app.log'),
      format: format.json(),
      maxsize: 10 * 1024 * 1024,  // 10 MB
      maxFiles: 7,
      tailable: true,
    }),
    // ── File: errors only ────────────────────────────────────────────────────
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: format.json(),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
  ],
  exceptionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, 'rejections.log') }),
  ],
});

// Ensure log directory exists (sync is fine at startup)
const fs = require('fs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

module.exports = logger;
