// src/middleware/requestTrace.js
// Usage: app.use(requestTrace) BEFORE routes in app.js
// Requires: npm install uuid
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('../config/logger');

module.exports = function requestTrace(req, res, next) {
  req.traceId   = req.headers['x-trace-id'] || uuid();
  req.startTime = Date.now();
  res.setHeader('x-trace-id', req.traceId);

  res.on('finish', () => {
    const ms    = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'debug';

    logger[level](`${req.method} ${req.path} ${res.statusCode} ${ms}ms`, {
      traceId: req.traceId,
      userId:  req.user?.userId ?? null,
      ip:      req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
      ua:      req.headers['user-agent']?.slice(0, 80),
    });
  });

  next();
};
