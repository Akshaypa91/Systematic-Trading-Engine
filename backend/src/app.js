// src/app.js — Systematic Trading Engine — Production Entry Point
'use strict';

require('dotenv').config();

const http     = require('http');
const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');

const logger   = require('./config/logger');
const db       = require('./config/database');
const C        = require('./config/constants');

const { apiLimiter, nseProxyLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFound }      = require('./middleware/errorHandler');

const dataRoutes     = require('./routes/data');
const signalRoutes   = require('./routes/signal');
const backtestRoutes = require('./routes/backtest');
const tradeRoutes    = require('./routes/trade');
const screenerRoutes = require('./routes/screener');
const authRoutes     = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolio');
const liveRoutes      = require('./routes/live');
const allRoutes      = require('./routes/index');

const liveDataFeed   = require('./data/liveDataFeed');
const scheduler      = require('./engine/scheduler');

const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(C.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: msg => logger.http(msg.trim()) },
}));

app.use('/api', apiLimiter);
app.use('/api/data', nseProxyLimiter);

app.get('/health', (req, res) => res.json({
  status: 'ok', service: 'systematic-trading-engine',
  env: C.NODE_ENV, timestamp: new Date().toISOString(),
  uptime: Math.round(process.uptime()),
  wsFeed: liveDataFeed.getStats(),
}));

app.use('/api/auth',     authRoutes);
app.use('/api/data',     dataRoutes);
app.use('/api/signal',   signalRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/trade',    tradeRoutes);
app.use('/api/screener', screenerRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/live',      liveRoutes);
app.use('/api',          allRoutes);

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await db.testConnection();
    logger.info('[App] Database connection verified');
  } catch (err) {
    logger.warn(`[App] DB unavailable: ${err.message} — starting in offline mode`);
  }

  liveDataFeed.attach(server);
  scheduler.start();

  server.listen(C.PORT, () => {
    logger.info(`[App] Running on port ${C.PORT} [${C.NODE_ENV}]`);
    logger.info(`[App] HTTP: http://localhost:${C.PORT}/health`);
    logger.info(`[App] WS:   ws://localhost:${C.PORT}/ws`);
    logger.info(`[App] API:  http://localhost:${C.PORT}/api/info`);
  });

  const shutdown = async (sig) => {
    logger.info(`[App] ${sig} received`);
    server.close(async () => { scheduler.stop(); await db.closePool(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
module.exports = { app, server };
