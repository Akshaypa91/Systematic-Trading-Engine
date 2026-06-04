// src/app.js — Production Entry Point
'use strict';

require('dotenv').config();

const http     = require('http');
const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');
const os       = require('os');

const logger   = require('./config/logger');
const db       = require('./config/database');
// const { initDB } = require('./config/initDB');
const C        = require('./config/constants');

const { apiLimiter, nseProxyLimiter, authLimiter, backtestLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const dataRoutes     = require('./routes/data');
const signalRoutes   = require('./routes/signal');
const backtestRoutes = require('./routes/backtest');
const tradeRoutes    = require('./routes/trade');
const screenerRoutes = require('./routes/screener');
const authRoutes     = require('./routes/auth');
const allRoutes      = require('./routes/index');
const simRoutes      = require('./routes/sim');
const liveRoutes     = require('./routes/live');
const feedbackRoutes = require('./routes/feedback');

const liveDataFeed = require('./data/liveDataFeed');
const scheduler    = require('./engine/scheduler');
const simEngine    = require('./engine/simulationEngine');
const requestTrace = require('./middleware/requestTrace');

// ── Validate critical env vars at startup ─────────────────────────────────────
function validateEnv() {
  const warnings = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'systra-secret-change-in-production') {
    warnings.push('JWT_SECRET is using the default insecure value — set a strong secret in production');
  }
  if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === '') {
    warnings.push('DB_PASSWORD is not set');
  }
  if (C.NODE_ENV === 'production' && !(process.env.JWT_SECRET?.length >= 32)) {
    warnings.push('JWT_SECRET should be at least 32 characters in production');
  }
  warnings.forEach(w => logger.warn(`[Config] ⚠️  ${w}`));
  return warnings;
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.set('trust proxy', 1);  // Required on Render for real IP

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .concat(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    logger.warn(`[CORS] Blocked: ${origin}`);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(morgan(C.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: msg => logger.http(msg.trim()) },
  skip:   (req) => req.path === '/health',
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api',        apiLimiter);
app.use('/api/data',   nseProxyLimiter);
app.use('/api/auth',   authLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
const _startTime = Date.now();

app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  try { await db.testConnection(); dbStatus = 'connected'; } catch { dbStatus = 'disconnected'; }

  const uptime   = Math.round((Date.now() - _startTime) / 1000);
  const mem      = process.memoryUsage();
  const isOk     = dbStatus === 'connected';

  res.status(isOk ? 200 : 503).json({
    status:    isOk ? 'healthy' : 'degraded',
    service:   'systematic-trading-engine',
    version:   process.env.npm_package_version || '2.0.0',
    env:       C.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime:    `${Math.floor(uptime / 60)}m ${uptime % 60}s`,
    db:        dbStatus,
    wsFeed:    liveDataFeed.getStats?.() || {},
    system: {
      platform:    os.platform(),
      nodeVersion: process.version,
      memory: {
        heapUsed:  `${Math.round(mem.heapUsed  / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
        rss:       `${Math.round(mem.rss       / 1024 / 1024)}MB`,
      },
    },
  });
});

app.get('/__debug/auth-ping', (req, res) =>
  res.json({ ok: true, msg: 'app.js reachable' })
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/feedback', feedbackRoutes);   // ← MOVED before /api catch-all
app.use('/api/data',     dataRoutes);
app.use('/api/signal',   signalRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/trade',    tradeRoutes);
app.use('/api/screener', screenerRoutes);
app.use('/api/sim',      simRoutes);
app.use('/api/live',     liveRoutes);
app.use('/api',          allRoutes);        // catch-all last

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);
app.use(requestTrace);

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  validateEnv();

  try {
    await db.testConnection();
    logger.info('[App] ✅ Database connected');
    const { failed } = await initDB();
    if (failed?.length > 0) logger.warn(`[App] ⚠️  Tables failed: ${failed.join(', ')}`);
  } catch (err) {
    logger.warn(`[App] ⚠️  DB unavailable: ${err.message} — starting in offline mode`);
  }

  liveDataFeed.attach(server);
  scheduler.start();

  try {
    const upstoxAuth = require('./services/upstoxAuth');
    const upstoxWS   = require('./ws/upstoxWS');
    if (upstoxAuth.isAuthenticated()) {
      upstoxWS.connect()
        .then(() => logger.info('[App] ✅ Upstox WebSocket connected'))
        .catch(err => logger.warn(`[App] Upstox WS failed: ${err.message}`));
    } else {
      logger.info('[App] ℹ️  Upstox not authenticated — visit /api/auth/upstox/login');
    }
  } catch (e) {
    logger.warn(`[App] Upstox init skipped: ${e.message}`);
  }

  simEngine.start({
    watchlist:  (process.env.SIM_WATCHLIST || 'RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,WIPRO,SBIN,AXISBANK,BAJFINANCE,KOTAKBANK').split(','),
    intervalMs: parseInt(process.env.SIM_INTERVAL_MS || '5000', 10),
  });
  logger.info('[App] 🤖 Simulation engine started');

  server.listen(C.PORT, () => {
    logger.info(`[App] 🚀 Running on port ${C.PORT} [${C.NODE_ENV}]`);
    logger.info(`[App] 🔗 Health: http://localhost:${C.PORT}/health`);
    logger.info(`[App] 🔗 WS:     ws://localhost:${C.PORT}/ws`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (sig) => {
    logger.info(`[App] ${sig} — shutting down`);
    server.close(async () => {
      try { simEngine.stop?.(); }   catch (_) {}
      try { scheduler?.stop?.(); } catch (_) {}
      try { require('./ws/upstoxWS').disconnect?.(); } catch (_) {}
      try { await db.closePool?.(); } catch (_) {}
      logger.info('[App] ✅ Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => { logger.error('[App] Forced exit'); process.exit(1); }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',  (err) => { logger.error(`[App] uncaughtException: ${err.message}`); shutdown('uncaughtException'); });
  process.on('unhandledRejection', (r)   => { logger.error(`[App] unhandledRejection: ${r}`); });
}

start();
module.exports = { app, server };