// src/middleware/requestTrace.js
// Adds traceId to every request for production debugging
// Usage: app.use(requestTrace) BEFORE routes
'use strict';

const logger = require('../config/logger');

let _counter = 0;

function shortId() {
  _counter = (_counter + 1) % 999999;
  return `${Date.now().toString(36)}-${_counter.toString(36).padStart(4,'0')}`;
}

module.exports = function requestTrace(req, res, next) {
  req.traceId   = req.headers['x-trace-id'] || shortId();
  req.startTime = Date.now();

  res.setHeader('x-trace-id', req.traceId);

  res.on('finish', () => {
    const ms    = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'debug';

    logger[level](`${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`, {
      traceId: req.traceId,
      userId:  req.user?.userId ?? null,
      ip:      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
      ms,
    });
  });

  next();
};
