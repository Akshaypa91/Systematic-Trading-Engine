// src/engine/scheduler.js — UPGRADED with live signal job
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES FROM ORIGINAL
// ─────────────────────
// • Added LIVE_SIGNALS job (every 5 min, market hours) → runs liveSignalEngine
// • Added PAPER_EXIT_CHECK job (every 2 min, market hours) → checks SL/TP
// • Added dynamic job API: addJob() for runtime job registration
// • getJobStatus() now includes nextRun estimate
// • All original jobs (MARKET_SCAN, SIGNAL_SNAPSHOT, DATA_SYNC) preserved
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const marketDataService = require('../services/marketDataService');
const dataStore       = require('../data/dataStore');
const screener        = require('../screener/screener');
const aggregator      = require('../strategies/aggregator');
const alertEngine     = require('./alertEngine');
const liveDataFeed    = require('../data/liveDataFeed');
const liveSignalEngine = require('./liveSignalEngine');
const execEngine      = require('./executionEngine');
const db              = require('../config/database');
const C               = require('../config/constants');
const logger          = require('../config/logger');

const jobs = new Map();

// ── Job registration ──────────────────────────────────────────────────────────

function registerJob(name, fn, intervalMs, opts = {}) {
  if (jobs.has(name)) {
    logger.warn(`[Scheduler] Job "${name}" already registered — skipping`);
    return;
  }

  const state = {
    name, intervalMs, running: false,
    lastRun: null, lastDuration: null, lastStatus: null,
    runCount: 0, errorCount: 0, enabled: true, timer: null,
    nextRunAt: null,
  };

  const execute = async () => {
    if (!state.enabled || state.running) return;
    if (opts.marketHoursOnly && !isMarketHours()) return;

    state.running = true;
    const start = Date.now();

    try {
      await fn();
      state.lastStatus = 'OK';
      state.runCount++;
    } catch (err) {
      state.lastStatus = `ERROR: ${err.message}`;
      state.errorCount++;
      logger.error(`[Scheduler] Job "${name}" failed: ${err.message}`);
    } finally {
      state.running      = false;
      state.lastRun      = new Date().toISOString();
      state.lastDuration = Date.now() - start;
      state.nextRunAt    = new Date(Date.now() + intervalMs).toISOString();
      logger.debug(`[Scheduler] "${name}" completed in ${state.lastDuration}ms — ${state.lastStatus}`);
    }
  };

  if (opts.runOnStart) execute();
  state.timer    = setInterval(execute, intervalMs);
  state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  jobs.set(name, { state, execute });

  logger.info(`[Scheduler] Registered job "${name}" every ${intervalMs / 1000}s`);
}

// Dynamic job addition at runtime (for testing / admin APIs)
function addJob(name, fn, intervalMs, opts = {}) {
  return registerJob(name, fn, intervalMs, opts);
}

function stopJob(name) {
  const job = jobs.get(name);
  if (!job) return false;
  clearInterval(job.state.timer);
  job.state.enabled = false;
  return true;
}

function getJobStatus() {
  return [...jobs.values()].map(({ state }) => ({
    name:         state.name,
    enabled:      state.enabled,
    running:      state.running,
    lastRun:      state.lastRun,
    lastDuration: state.lastDuration,
    lastStatus:   state.lastStatus,
    runCount:     state.runCount,
    errorCount:   state.errorCount,
    intervalMs:   state.intervalMs,
    nextRunAt:    state.nextRunAt,
  }));
}

// ── Market hours ──────────────────────────────────────────────────────────────

function isMarketHours() {
  const now  = new Date();
  const ist  = new Date(now.getTime() + 5.5 * 3600000);
  const day  = ist.getUTCDay();
  const time = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (day === 0 || day === 6) return false;
  return time >= 555 && time <= 930;  // 09:15–15:30 IST
}

// ── Job definitions ───────────────────────────────────────────────────────────

// NEW: Run live signal engine tick (every 5 min, market hours only)
async function liveSignalsJob() {
  const result = await liveSignalEngine.runOnce();
  logger.info(`[Scheduler] Live signals: ${result.signals.length} generated, ${result.errors} errors`);
}

// NEW: Check paper positions for SL/TP exits every 2 minutes
async function paperExitCheckJob() {
  const portfolio = execEngine.getPortfolioState();
  const openSymbols = Object.keys(portfolio.openPositions);
  if (openSymbols.length === 0) return;

  logger.debug(`[Scheduler] Paper exit check: ${openSymbols.length} open positions`);

  for (const symbol of openSymbols) {
    try {
      const bars = await dataStore.getRecentPrices(symbol, 5);
      if (!bars || bars.length === 0) continue;
      const currentPrice = bars[bars.length - 1].close;
      const result = await execEngine.checkAndClosePosition(symbol, currentPrice);
      if (result) {
        logger.info(`[Scheduler] Paper: ${symbol} auto-closed via ${result.exitReason ?? 'SL/TP'}`);
      }
    } catch (err) {
      logger.warn(`[Scheduler] Exit check failed for ${symbol}: ${err.message}`);
    }
  }
}

// Preserved: Market scan (screener + alerts)
async function marketScanJob() {
  logger.info('[Scheduler] Running market scan...');
  const symbols = C.NIFTY50_SYMBOLS.slice(0, 20);
  const results = await screener.runScreener(symbols, { topN: 10, filter: 'ALL' });
  let alertsFired = 0;

  for (const stock of results) {
    try {
      const bars = await dataStore.getRecentPrices(stock.symbol, 220);
      if (!bars || bars.length < 15) continue;
      const closes = bars.map(b => b.close);
      const price  = closes.at(-1);
      const fired  = await alertEngine.evaluateAlerts(stock.symbol, price, closes, bars.at(-1)?.volume || 0);
      if (fired.length > 0) {
        alertsFired += fired.length;
        liveDataFeed.broadcastAlert({ alerts: fired, source: 'MARKET_SCAN', symbol: stock.symbol });
      }
    } catch { /* non-critical per symbol */ }
  }

  if (alertsFired > 0) logger.info(`[Scheduler] Market scan fired ${alertsFired} alerts`);
}

// Preserved: Signal snapshot (hourly)
async function signalSnapshotJob() {
  logger.info('[Scheduler] Generating signal snapshots...');
  const symbols = C.NIFTY50_SYMBOLS.slice(0, 15);
  let saved = 0;

  for (const symbol of symbols) {
    try {
      const bars = await dataStore.getRecentPrices(symbol, 220);
      if (!bars || bars.length < 202) continue;
      const closes = bars.map(b => b.close);
      const result = aggregator.aggregate(closes, { method: 'weighted' });
      await db.query(
        `INSERT INTO signals (symbol, signal_type, strategy, confidence, price_at_signal) VALUES (?, ?, 'AGGREGATED', ?, ?)`,
        [symbol, result.signal, result.confidence, closes.at(-1)]
      );
      saved++;
    } catch { /* non-critical */ }
  }

  logger.info(`[Scheduler] Signal snapshot: saved ${saved}/${symbols.length} signals`);
}

// Preserved: EOD data sync (daily)
async function dataSyncJob() {
  logger.info('[Scheduler] Running EOD data sync via marketDataService...');
  let synced = 0;

  // Twelve Data free tier: fetch live price per symbol and store as today EOD row.
  // Historical OHLCV bulk import is not available on the free plan.
  for (const symbol of C.NIFTY50_SYMBOLS.slice(0, 10)) {
    try {
      const result = await marketDataService.getLivePrice(symbol);
      const today  = new Date().toISOString().slice(0, 10);
      const rows   = [{
        symbol,
        date:     today,
        open:     result.price,
        high:     result.price,
        low:      result.price,
        close:    result.price,
        vwap:     result.price,
        volume:   0,
        exchange: 'NSE',
      }];
      await dataStore.saveDailyPrices(rows);
      synced++;
      logger.info(`[Scheduler] EOD sync: ${symbol} = \u20b9${result.price} (${result.source})`);
    } catch (err) {
      logger.warn(`[Scheduler] Sync failed for ${symbol}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info(`[Scheduler] EOD sync complete: ${synced}/10 symbols updated`);
}

// ── Initialise all jobs ───────────────────────────────────────────────────────

function start() {
  // NEW jobs
  registerJob('LIVE_SIGNALS',      liveSignalsJob,      5  * 60 * 1000, { marketHoursOnly: true,  runOnStart: false });
  registerJob('PAPER_EXIT_CHECK',  paperExitCheckJob,   2  * 60 * 1000, { marketHoursOnly: true,  runOnStart: false });
  // Preserved jobs
  registerJob('MARKET_SCAN',       marketScanJob,       15 * 60 * 1000, { marketHoursOnly: true,  runOnStart: false });
  registerJob('SIGNAL_SNAPSHOT',   signalSnapshotJob,   60 * 60 * 1000, { marketHoursOnly: false, runOnStart: false });
  registerJob('DATA_SYNC',         dataSyncJob,         24 * 60 * 60 * 1000, { marketHoursOnly: false, runOnStart: false });

  logger.info(`[Scheduler] Started ${jobs.size} jobs`);
}

function stop() {
  for (const [name] of jobs) stopJob(name);
  jobs.clear();
  logger.info('[Scheduler] All jobs stopped');
}

module.exports = { start, stop, registerJob, addJob, stopJob, getJobStatus, isMarketHours };
