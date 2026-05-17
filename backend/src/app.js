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
const { initDB } = require('./config/initDB');
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

const liveDataFeed    = require('./data/liveDataFeed');
const scheduler       = require('./engine/scheduler');
const simEngine       = require('./engine/simulationEngine');
const feedbackRoutes = require('./routes/feedback');

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

// ── App setup ──────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

if (C.NODE_ENV === 'production') app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(morgan(C.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: msg => logger.http(msg.trim()) },
  skip:   (req) => req.path === '/health',
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api',            apiLimiter);
app.use('/api/data',       nseProxyLimiter);
app.use('/api/auth',       authLimiter);
// ── Backtest: limit only POST /api/backtest (CPU-intensive run) ───────────────
// GET /api/backtest/runs is a cheap DB read — don't rate-limit it
// Applied per-route in backtest.js, not here globally

// ── Health check ──────────────────────────────────────────────────────────────
const _startTime = Date.now();

app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  try {
    await db.testConnection();
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  const uptime    = Math.round((Date.now() - _startTime) / 1000);
  const memUsage  = process.memoryUsage();
  const isHealthy = dbStatus === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status:    isHealthy ? 'healthy' : 'degraded',
    service:   'systematic-trading-engine',
    version:   process.env.npm_package_version || '1.0.0',
    env:       C.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime:    `${Math.floor(uptime / 60)}m ${uptime % 60}s`,
    db:        dbStatus,
    scheduler: scheduler.getJobStatus().map(j => ({ name: j.name, status: j.lastStatus, runs: j.runCount })),
    wsFeed:    liveDataFeed.getStats(),
    system: {
      platform:    os.platform(),
      nodeVersion: process.version,
      memory: {
        rss:      `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal:`${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      },
      loadAvg: os.loadavg().map(n => n.toFixed(2)),
    },
  });
});

// ── DEBUG: lightweight probe to confirm auth router is reachable ─────────────
// Hit GET /__debug/auth-ping — if this 404s, your auth router isn't mounted.
app.get('/__debug/auth-ping', (req, res) => {
  res.json({ ok: true, msg: 'app.js is reachable; check auth router separately' });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/data',     dataRoutes);
app.use('/api/signal',   signalRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/trade',    tradeRoutes);
app.use('/api/screener', screenerRoutes);
app.use('/api/sim',      simRoutes);
app.use('/api/live',     liveRoutes);
app.use('/api',          allRoutes);
app.use('/api/feedback', feedbackRoutes);

// ── Error handling (must be last) ────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── DEBUG: print every registered route at boot ──────────────────────────────
function dumpRoutes(appInstance) {
  const out = [];
  const walk = (stack, prefix = '') => {
    stack.forEach((layer) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
        out.push(`${methods.padEnd(8)} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle.stack) {
        // Extract mount path from regexp (best-effort)
        const match = layer.regexp?.toString().match(/\^\\?\/([^\\?]+)/);
        const mount = match ? '/' + match[1].replace(/\\\//g, '/') : '';
        walk(layer.handle.stack, prefix + mount);
      }
    });
  };
  walk(appInstance._router.stack);
  logger.info('\n==== Registered Routes ====\n' + out.join('\n') + '\n===========================');
}

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  const warnings = validateEnv();
  if (warnings.length > 0 && C.NODE_ENV === 'production') {
    logger.error('[App] Critical config warnings in production — review above');
  }

  try {
    await db.testConnection();
    logger.info('[App] ✅ Database connected');
    const { failed } = await initDB();
    if (failed.length > 0) {
      logger.warn(`[App] ⚠️  Some tables failed to initialise: ${failed.join(', ')}`);
    }
  } catch (err) {
    logger.warn(`[App] ⚠️  DB unavailable: ${err.message} — starting in offline mode`);
  }

  liveDataFeed.attach(server);
  scheduler.start();

  try {
    const upstoxWS   = require('./ws/upstoxWS');
    const upstoxAuth = require('./services/upstoxAuth');
    if (upstoxAuth.isAuthenticated()) {
      upstoxWS.connect().then(() => {
        logger.info('[App] ✅ Upstox WebSocket connected (pre-set token)');
      }).catch(err => {
        logger.warn(`[App] Upstox WS connect failed: ${err.message} — prices fall back to TwelveData/SIM`);
      });
    } else {
      logger.info('[App] ℹ️  Upstox not authenticated — visit /api/auth/upstox/login to connect');
    }
  } catch (upstoxErr) {
    logger.warn(`[App] Upstox init skipped: ${upstoxErr.message}`);
  }

  simEngine.start({
    watchlist: ['RELIANCE','INFY','TCS','HDFCBANK','ICICIBANK','WIPRO','SBIN','AXISBANK','BAJFINANCE','MARUTI'],
    intervalMs: parseInt(process.env.SIM_INTERVAL_MS || '5000', 10),
  });
  logger.info('[App] 🤖 Simulation engine started (paper trading active)');

  server.listen(C.PORT, () => {
    logger.info(`[App] ✅ Running on port ${C.PORT} [${C.NODE_ENV}]`);
    logger.info(`[App] 🔗 Health:  http://localhost:${C.PORT}/health`);
    logger.info(`[App] 🔗 API:     http://localhost:${C.PORT}/api/info`);
    logger.info(`[App] 🔗 WS:      ws://localhost:${C.PORT}/ws`);
    dumpRoutes(app);   // 👈 print all routes after server starts
  });

  const shutdown = async (sig) => {
    logger.info(`[App] ${sig} — shutting down gracefully`);
    server.close(async () => {
      try {
        simEngine.stop();
        scheduler.stop();
        try { require('./ws/upstoxWS').disconnect(); } catch (_) {}
        await db.closePool();
        logger.info('[App] Clean shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error(`[App] Shutdown error: ${err.message}`);
        process.exit(1);
      }
    });
    setTimeout(() => {
      logger.error('[App] Forced shutdown after 15s timeout');
      process.exit(1);
    }, 15_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error(`[App] Uncaught exception: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`[App] Unhandled rejection: ${reason}`);
  });
}

start();
module.exports = { app, server };
