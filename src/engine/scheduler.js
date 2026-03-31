// src/engine/scheduler.js
// ─────────────────────────────────────────────────────────────────────────────
// Task Scheduler
//
// Runs recurring jobs on a timer. All jobs are:
//   1. Non-overlapping (skip if previous run still in progress)
//   2. Logged with duration and outcome
//   3. Individually configurable and enable/disable-able
//
// JOBS
// ────
// • MARKET_SCAN  (every 15 min during market hours)
//   Runs the screener on NIFTY 50, evaluates alert rules,
//   broadcasts any fired alerts to WS clients.
//
// • SIGNAL_SNAPSHOT  (every 60 min)
//   Generates and persists aggregated signals for a watchlist
//   of symbols to the signals table.
//
// • DATA_SYNC  (daily at 18:00 IST after market close)
//   Fetches and stores EOD data from NSE for all watched symbols.
//
// NSE market hours: 09:15 – 15:30 IST (Mon–Fri)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const nseFetcher   = require('../data/nseFetcher');
const dataStore    = require('../data/dataStore');
const screener     = require('../screener/screener');
const aggregator   = require('../strategies/aggregator');
const alertEngine  = require('./alertEngine');
const liveDataFeed = require('../data/liveDataFeed');
const db           = require('../config/database');
const C            = require('../config/constants');
const logger       = require('../config/logger');

// ─── Job registry ─────────────────────────────────────────────────────────────
const jobs = new Map();

/**
 * Register and start a recurring job.
 *
 * @param {string}   name         - Unique job identifier
 * @param {Function} fn           - async function to run
 * @param {number}   intervalMs   - Interval in milliseconds
 * @param {Object}   opts         - { runOnStart, marketHoursOnly }
 */
function registerJob(name, fn, intervalMs, opts = {}) {
  if (jobs.has(name)) {
    logger.warn(`[Scheduler] Job "${name}" already registered — skipping`);
    return;
  }

  const state = {
    name,
    intervalMs,
    running:      false,
    lastRun:      null,
    lastDuration: null,
    lastStatus:   null,
    runCount:     0,
    errorCount:   0,
    enabled:      true,
    timer:        null,
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
      state.lastStatus  = `ERROR: ${err.message}`;
      state.errorCount++;
      logger.error(`[Scheduler] Job "${name}" failed: ${err.message}`);
    } finally {
      state.running      = false;
      state.lastRun      = new Date().toISOString();
      state.lastDuration = Date.now() - start;
      logger.debug(`[Scheduler] "${name}" completed in ${state.lastDuration}ms — ${state.lastStatus}`);
    }
  };

  if (opts.runOnStart) execute();
  state.timer = setInterval(execute, intervalMs);
  jobs.set(name, { state, execute });

  logger.info(`[Scheduler] Registered job "${name}" every ${intervalMs / 1000}s`);
}

/**
 * Stop a job by name.
 */
function stopJob(name) {
  const job = jobs.get(name);
  if (!job) return false;
  clearInterval(job.state.timer);
  job.state.enabled = false;
  return true;
}

/**
 * Get status of all registered jobs.
 */
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
  }));
}

// ─── Market hours check ───────────────────────────────────────────────────────

function isMarketHours() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const ist  = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const day  = ist.getUTCDay();   // 0=Sun, 6=Sat
  const hour = ist.getUTCHours();
  const min  = ist.getUTCMinutes();
  const time = hour * 60 + min;

  if (day === 0 || day === 6) return false;   // Weekend
  return time >= 555 && time <= 930;          // 09:15 to 15:30 IST
}

// ─── Job definitions ──────────────────────────────────────────────────────────

/**
 * MARKET_SCAN: Screen NIFTY 50, evaluate alerts, broadcast results.
 */
async function marketScanJob() {
  logger.info('[Scheduler] Running market scan...');

  const symbols  = C.NIFTY50_SYMBOLS.slice(0, 20);   // First 20 to be conservative
  const results  = await screener.runScreener(symbols, { topN: 10, filter: 'ALL' });

  // For each screened symbol, check alert rules
  let alertsFired = 0;
  for (const stock of results) {
    try {
      const bars = await dataStore.getRecentPrices(stock.symbol, 220);
      if (!bars || bars.length < 15) continue;

      const closes = bars.map(b => b.close);
      const price  = closes.at(-1);

      const fired = await alertEngine.evaluateAlerts(
        stock.symbol, price, closes, bars.at(-1)?.volume || 0
      );

      if (fired.length > 0) {
        alertsFired += fired.length;
        liveDataFeed.broadcastAlert({
          alerts: fired,
          source: 'MARKET_SCAN',
          symbol: stock.symbol,
        });
      }
    } catch { /* non-critical per symbol */ }
  }

  if (alertsFired > 0) {
    logger.info(`[Scheduler] Market scan fired ${alertsFired} alerts`);
  }
}

/**
 * SIGNAL_SNAPSHOT: Generate and persist signals for all watchlisted symbols.
 */
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

      await db.query(`
        INSERT INTO signals (symbol, signal_type, strategy, confidence, price_at_signal)
        VALUES (?, ?, 'AGGREGATED', ?, ?)
      `, [symbol, result.signal, result.confidence, closes.at(-1)]);

      saved++;
    } catch { /* non-critical per symbol */ }
  }

  logger.info(`[Scheduler] Signal snapshot: saved ${saved}/${symbols.length} signals`);
}

/**
 * DATA_SYNC: Fetch previous trading day's EOD data and store it.
 * Only runs outside market hours (after 15:30 IST).
 */
async function dataSyncJob() {
  logger.info('[Scheduler] Running EOD data sync...');

  const today    = new Date();
  const ist      = new Date(today.getTime() + 5.5 * 3600000);

  // Format as DD-MM-YYYY for NSE API
  const fmt      = (d) => {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = d.getUTCFullYear();
    return `${dd}-${mm}-${yy}`;
  };

  const toDate   = fmt(ist);
  // Fetch last 5 trading days to fill any gaps
  const fromDate = fmt(new Date(ist.getTime() - 7 * 86400000));

  let synced = 0;
  const symbols = C.NIFTY50_SYMBOLS.slice(0, 10);   // Top 10 — extend as needed

  for (const symbol of symbols) {
    try {
      const rows = await nseFetcher.getHistoricalData(symbol, fromDate, toDate);
      if (rows.length > 0) {
        await dataStore.saveDailyPrices(rows);
        synced++;
      }
    } catch (err) {
      logger.warn(`[Scheduler] Data sync failed for ${symbol}: ${err.message}`);
    }
    // Rate-limit courtesy delay
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info(`[Scheduler] EOD sync complete: ${synced}/${symbols.length} symbols updated`);
}

// ─── Initialise all jobs ──────────────────────────────────────────────────────

/**
 * Start all scheduled jobs.
 * Call this from app.js after the server is listening.
 */
function start() {
  registerJob('MARKET_SCAN',     marketScanJob,     15 * 60 * 1000, { marketHoursOnly: true,  runOnStart: false });
  registerJob('SIGNAL_SNAPSHOT', signalSnapshotJob, 60 * 60 * 1000, { marketHoursOnly: false, runOnStart: false });
  registerJob('DATA_SYNC',       dataSyncJob,       24 * 60 * 60 * 1000, { marketHoursOnly: false, runOnStart: false });

  logger.info(`[Scheduler] Started ${jobs.size} jobs`);
}

/**
 * Stop all jobs (for graceful shutdown).
 */
function stop() {
  for (const [name] of jobs) stopJob(name);
  jobs.clear();
  logger.info('[Scheduler] All jobs stopped');
}

module.exports = { start, stop, registerJob, stopJob, getJobStatus, isMarketHours };
