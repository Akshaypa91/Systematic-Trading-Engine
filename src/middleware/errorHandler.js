'use strict';
const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  logger.error(`[HTTP ${status}] ${req.method} ${req.path} — ${err.message}`);
  res.status(status).json({
    success: false,
    error:   err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

function notFound(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
}

module.exports = { errorHandler, notFound };
