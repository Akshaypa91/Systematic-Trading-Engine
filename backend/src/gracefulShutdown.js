// src/gracefulShutdown.js
// Usage: require('./gracefulShutdown')(server, { db, redis, simEngine })
'use strict';

const logger = require('./config/logger');

module.exports = function setupGracefulShutdown(server, deps = {}) {
  const { db, redis, simEngine } = deps;
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`[Shutdown] ${signal} received — starting graceful shutdown`);

    // 1. Stop accepting new HTTP connections
    server.close(async () => {
      logger.info('[Shutdown] HTTP server closed');
    });

    // 2. Stop simulation engine (stops tick loop)
    if (simEngine?.stop) {
      simEngine.stop();
      logger.info('[Shutdown] Simulation engine stopped');
    }

    // 3. Wait for in-flight requests (max 8s)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Close Redis connection
    if (redis?.quit) {
      try { await redis.quit(); logger.info('[Shutdown] Redis disconnected'); }
      catch (e) { logger.warn(`[Shutdown] Redis quit error: ${e.message}`); }
    }

    // 5. Drain PostgreSQL/CockroachDB pool
    if (db?.closePool) {
      try { await db.closePool(); logger.info('[Shutdown] database pool drained'); }
      catch (e) { logger.warn(`[Shutdown] database close error: ${e.message}`); }
    }

    logger.info('[Shutdown] ✅ Clean exit');
    process.exit(0);
  }

  // Force exit after 10s — prevents hanging on stuck connections
  const forceExit = setTimeout(() => {
    logger.error('[Shutdown] ⚠️  Forced exit after 10s timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref(); // Don't keep process alive just for this timer

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error('[Process] uncaughtException', { message: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('[Process] unhandledRejection', { reason: String(reason) });
    // Don't exit on unhandled rejection — log and continue
  });

  logger.info('[Shutdown] Graceful shutdown handlers registered');
};
