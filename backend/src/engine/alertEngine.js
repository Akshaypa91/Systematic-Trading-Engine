// src/engine/alertEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// Alert Engine
//
// Monitors watchlisted symbols for configurable conditions:
//   • Price crosses above/below threshold
//   • Signal strength exceeds confidence threshold
//   • Z-score enters extreme zone
//   • RSI enters oversold/overbought
//   • Volume spike (volume > N × 20-day average)
//
// Alerts are:
//   1. Stored in memory (in-process queue)
//   2. Broadcast to all WebSocket clients via liveDataFeed
//   3. Persisted to DB (alert_log table — see schema)
//   4. Extensible: add email/webhook handlers here
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const dataStore  = require('../data/dataStore');
const aggregator = require('../strategies/aggregator');
const mu         = require('../utils/mathUtils');
const logger     = require('../config/logger');

// ─── In-memory alert store ────────────────────────────────────────────────────
// Replace with Redis pub/sub for multi-process deployments
const alertQueue   = [];
const MAX_QUEUE    = 500;

// Alert rules: Map of symbol → Array<AlertRule>
const watchlist    = new Map();

/**
 * AlertRule shape:
 * {
 *   id:         string,
 *   symbol:     string,
 *   type:       'PRICE_ABOVE' | 'PRICE_BELOW' | 'SIGNAL_BUY' | 'SIGNAL_SELL'
 *               | 'ZSCORE_EXTREME' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT'
 *               | 'VOLUME_SPIKE',
 *   threshold:  number,      // depends on type
 *   triggered:  boolean,     // prevents repeat alerts until reset
 *   createdAt:  string,
 * }
 */

// ─── Rule management ─────────────────────────────────────────────────────────

/**
 * Add an alert rule for a symbol.
 * @param {Object} rule
 * @returns {string} ruleId
 */
function addAlert(rule) {
  const id = `ALR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const entry = { ...rule, id, triggered: false, createdAt: new Date().toISOString() };

  if (!watchlist.has(rule.symbol)) watchlist.set(rule.symbol, []);
  watchlist.get(rule.symbol).push(entry);

  logger.info(`[Alert] Rule added: ${id} | ${rule.symbol} | ${rule.type} @ ${rule.threshold}`);
  return id;
}

/**
 * Remove an alert rule by id.
 */
function removeAlert(ruleId) {
  for (const [symbol, rules] of watchlist) {
    const idx = rules.findIndex(r => r.id === ruleId);
    if (idx !== -1) {
      rules.splice(idx, 1);
      if (rules.length === 0) watchlist.delete(symbol);
      logger.info(`[Alert] Rule removed: ${ruleId}`);
      return true;
    }
  }
  return false;
}

/**
 * Reset a triggered alert so it can fire again.
 */
function resetAlert(ruleId) {
  for (const rules of watchlist.values()) {
    const rule = rules.find(r => r.id === ruleId);
    if (rule) { rule.triggered = false; return true; }
  }
  return false;
}

/**
 * Get all current alert rules (optionally filtered by symbol).
 */
function getAlerts(symbol) {
  if (symbol) return watchlist.get(symbol.toUpperCase()) || [];
  return [...watchlist.values()].flat();
}

// ─── Alert evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate all alert rules for a symbol against current market data.
 * Should be called on every price tick or scheduled scan.
 *
 * @param {string}   symbol
 * @param {number}   currentPrice
 * @param {number[]} recentCloses  - Recent close prices for indicator computation
 * @param {number}   currentVolume
 * @returns {Promise<Array>} Fired alerts
 */
async function evaluateAlerts(symbol, currentPrice, recentCloses = [], currentVolume = 0) {
  const rules = watchlist.get(symbol.toUpperCase());
  if (!rules || rules.length === 0) return [];

  const fired = [];

  // Compute indicators once for all rules
  const rsiValue  = recentCloses.length >= 16 ? mu.rsi(recentCloses, 14) : null;
  const zScore    = recentCloses.length >= 20
    ? (() => {
        const w = recentCloses.slice(-20);
        const s = mu.stdDev(w);
        return s > 0 ? (currentPrice - mu.mean(w)) / s : 0;
      })()
    : null;

  // Volume spike: compare against 20-period avg volume
  let volumeAvg = null;
  let volSpike  = false;
  if (currentVolume > 0) {
    try {
      const bars = await dataStore.getRecentPrices(symbol, 21);
      if (bars && bars.length >= 20) {
        volumeAvg = mu.mean(bars.slice(0, 20).map(b => b.volume || 0));
        volSpike  = volumeAvg > 0 && currentVolume > volumeAvg * 2;
      }
    } catch { /* non-critical */ }
  }

  // Aggregated signal (only computed if a SIGNAL rule exists)
  let signalResult = null;
  const hasSignalRule = rules.some(r => r.type === 'SIGNAL_BUY' || r.type === 'SIGNAL_SELL');
  if (hasSignalRule && recentCloses.length >= 202) {
    signalResult = aggregator.aggregate(recentCloses, { method: 'weighted' });
  }

  for (const rule of rules) {
    if (rule.triggered) continue;

    let shouldFire = false;
    let message    = '';

    switch (rule.type) {
      case 'PRICE_ABOVE':
        shouldFire = currentPrice >= rule.threshold;
        message    = `${symbol} price ₹${currentPrice} crossed above ₹${rule.threshold}`;
        break;

      case 'PRICE_BELOW':
        shouldFire = currentPrice <= rule.threshold;
        message    = `${symbol} price ₹${currentPrice} dropped below ₹${rule.threshold}`;
        break;

      case 'SIGNAL_BUY':
        shouldFire = signalResult?.signal === 'BUY' &&
                     signalResult.confidence >= (rule.threshold || 0.5);
        message    = `${symbol} BUY signal | confidence=${signalResult?.confidence?.toFixed(3)}`;
        break;

      case 'SIGNAL_SELL':
        shouldFire = signalResult?.signal === 'SELL' &&
                     signalResult.confidence >= (rule.threshold || 0.5);
        message    = `${symbol} SELL signal | confidence=${signalResult?.confidence?.toFixed(3)}`;
        break;

      case 'ZSCORE_EXTREME':
        if (zScore !== null) {
          shouldFire = Math.abs(zScore) >= (rule.threshold || 2.0);
          message    = `${symbol} Z-score ${zScore.toFixed(3)} exceeded ±${rule.threshold}`;
        }
        break;

      case 'RSI_OVERSOLD':
        if (rsiValue !== null) {
          shouldFire = rsiValue <= (rule.threshold || 30);
          message    = `${symbol} RSI ${rsiValue.toFixed(2)} is oversold (≤${rule.threshold})`;
        }
        break;

      case 'RSI_OVERBOUGHT':
        if (rsiValue !== null) {
          shouldFire = rsiValue >= (rule.threshold || 70);
          message    = `${symbol} RSI ${rsiValue.toFixed(2)} is overbought (≥${rule.threshold})`;
        }
        break;

      case 'VOLUME_SPIKE':
        shouldFire = volSpike;
        message    = `${symbol} volume spike: ${currentVolume.toLocaleString()} vs avg ${Math.round(volumeAvg || 0).toLocaleString()}`;
        break;
    }

    if (shouldFire) {
      rule.triggered = true;
      const alert = {
        ruleId:    rule.id,
        symbol,
        type:      rule.type,
        message,
        price:     currentPrice,
        rsiValue:  rsiValue ? parseFloat(rsiValue.toFixed(2)) : null,
        zScore:    zScore   ? parseFloat(zScore.toFixed(4))   : null,
        ts:        new Date().toISOString(),
      };

      fired.push(alert);
      enqueue(alert);
      logger.info(`[Alert] FIRED: ${message}`);
    }
  }

  return fired;
}

// ─── Queue management ─────────────────────────────────────────────────────────

function enqueue(alert) {
  alertQueue.unshift(alert);
  if (alertQueue.length > MAX_QUEUE) alertQueue.pop();
}

function getRecentAlerts(limit = 50) {
  return alertQueue.slice(0, limit);
}

function clearAlerts() {
  alertQueue.length = 0;
}

module.exports = {
  addAlert,
  removeAlert,
  resetAlert,
  getAlerts,
  evaluateAlerts,
  getRecentAlerts,
  clearAlerts,
};
