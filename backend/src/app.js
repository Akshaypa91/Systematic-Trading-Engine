// src/app.js — SYSTRA Trading Engine
'use strict';

// ── Environment validation (must be first) ────────────────────────────────────
require('dotenv').config();

// ── Core imports ──────────────────────────────────────────────────────────────
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const morgan     = require('morgan');
const helmet     = require('helmet');

// ── Internal imports ──────────────────────────────────────────────────────────
const db          = require('./config/database');
const logger      = require('./config/logger');
const initDB      = require('./config/initDB');
const C           = require('./config/constants');

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const simRoutes       = require('./routes/sim');
const tradeRoutes     = require('./routes/trade');
const backtestRoutes  = require('./routes/backtest');
const dataRoutes      = require('./routes/data');
const signalRoutes    = require('./routes/signal');
const screenerRoutes  = require('./routes/screener');
const analyticsRoutes = require('./routes/analytics');
const liveRoutes      = require('./routes/live');

// ── Middleware ────────────────────────────────────────────────────────────────
const { apiLimiter, authLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// ── Services & engines ────────────────────────────────────────────────────────
const liveDataFeed    = require('./data/liveDataFeed');
const simEngine       = require('./engine/simulationEngine');
const scheduler       = require('./engine/schedulerEngine');

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── Allowed origins ───────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)
  .concat([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ]);

// ── Global middleware ─────────────────────────────────────────────────────────
app.set('trust proxy', 1);  // Required on Render — gets real client IP

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,  // Handled by Vercel frontend
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    logger.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-trace-id'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// HTTP request logging (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.path === '/health',
  }));
}

// Rate limiting
app.use('/api/', apiLimiter);
app.use('/api/auth/login',  authLimiter);
app.use('/api/auth/signup', authLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbOk = false;
  try { await db.query('SELECT 1'); dbOk = true; } catch (_) {}

  const status = dbOk ? 'ok' : 'degraded';
  return res.status(dbOk ? 200 : 503).json({
    status,
    ts:        new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    memory:    Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    db:        dbOk ? 'connected' : 'error',
    simEngine: simEngine.getStatus?.()?.running ? 'running' : 'stopped',
    wsClients: liveDataFeed.getStats?.()?.connectedClients ?? 0,
    version:   process.env.npm_package_version || '2.0.0',
  });
});

app.get('/api/info', (req, res) => res.json({
  name:    'SYSTRA Trading Engine',
  version: '2.0.0',
  env:     process.env.NODE_ENV || 'development',
}));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/sim',       simRoutes);
app.use('/api/trade',     tradeRoutes);
app.use('/api/backtest',  backtestRoutes);
app.use('/api/data',      dataRoutes);
app.use('/api/signal',    signalRoutes);
app.use('/api/screener',  screenerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/live',      liveRoutes);

// Feedback — inline to avoid separate route file dependency
app.post('/api/feedback', require('./middleware/authMiddleware').optionalAuth, require('./controllers/authController').submitFeedback);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    // 1. Connect DB
    await db.query('SELECT 1');
    logger.info('[App] ✅ Database connected');

    // 2. Init tables
    await initDB();
    logger.info('[App] ✅ Database tables ready');

    // 3. Attach WebSocket
    liveDataFeed.attach(server);
    logger.info('[App] ✅ WebSocket server attached');

    // 4. Start simulation engine
    simEngine.start({
      watchlist:  (process.env.SIM_WATCHLIST || 'RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,WIPRO,SBIN,AXISBANK,BAJFINANCE,KOTAKBANK').split(','),
      intervalMs: parseInt(process.env.SIM_INTERVAL_MS || '3000', 10),
    });
    logger.info('[App] ✅ Simulation engine started');

    // 5. Start scheduler
    if (scheduler?.start) {
      scheduler.start();
      logger.info('[App] ✅ Scheduler started');
    }

    // 6. Try Upstox WS if token available
    if (process.env.UPSTOX_ACCESS_TOKEN) {
      try {
        const upstoxAuth = require('./services/upstoxAuth');
        upstoxAuth.setAccessToken(process.env.UPSTOX_ACCESS_TOKEN);
        const upstoxWS = require('./ws/upstoxWS');
        upstoxWS.connect();
        logger.info('[App] ✅ Upstox WebSocket connecting');
      } catch (e) {
        logger.warn(`[App] Upstox WS skipped: ${e.message}`);
      }
    }

    // 7. Listen
    server.listen(PORT, () => {
      logger.info(`[App] 🚀 SYSTRA running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });

  } catch (err) {
    logger.error(`[App] ❌ Startup failed: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`[App] ${signal} — shutting down gracefully`);

  server.close(async () => {
    logger.info('[App] HTTP server closed');
    try { simEngine.stop?.(); } catch (_) {}
    try { scheduler?.stop?.(); } catch (_) {}
    try { await db.end(); logger.info('[App] DB pool closed'); } catch (_) {}
    logger.info('[App] ✅ Shutdown complete');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => { logger.error('[App] Force exit'); process.exit(1); }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error(`[App] unhandledRejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`[App] uncaughtException: ${err.message}`);
  shutdown('uncaughtException');
});

start();

module.exports = { app, server };
