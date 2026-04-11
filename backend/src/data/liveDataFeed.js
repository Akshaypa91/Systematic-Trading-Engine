// src/data/liveDataFeed.js
// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Live Data Feed Manager
//
// Architecture:
//   • Client WebSocket connections → this manager
//   • NSE quote polling (since NSE doesn't expose a public WS) → broadcast
//   • Subscriptions per symbol — only poll what clients are watching
//   • Auto-check open paper positions on every price tick (stop-loss / TP)
//
// NSE does not provide a public WebSocket endpoint. We simulate a live feed
// by polling the REST quote API at configurable intervals, then broadcasting
// OHLCV + signal snapshots to all connected WebSocket clients.
//
// In production, replace the poller with a proper NSE TBT (Tick-By-Tick) or
// Zerodha Kite WebSocket feed for actual real-time data.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const WebSocket   = require('ws');
const url         = require('url');
const nseFetcher  = require('./nseFetcher');
const aggregator  = require('../strategies/aggregator');
const dataStore   = require('./dataStore');
const execEngine  = require('../engine/executionEngine');
const logger      = require('../config/logger');
const { verifyJWT } = require('../controllers/authController');

// ─── State ────────────────────────────────────────────────────────────────────
const subscriptions = new Map();   // symbol → Set<WebSocket>
const lastPrices    = new Map();   // symbol → { price, ts }
const pollIntervals = new Map();   // symbol → NodeJS timer
const clients       = new Set();   // all connected WS clients

const POLL_INTERVAL_MS = parseInt(process.env.LIVE_POLL_INTERVAL_MS || '5000', 10);

// ─── WebSocket Server ─────────────────────────────────────────────────────────

/**
 * Attach the WebSocket server to an existing HTTP server instance.
 * @param {http.Server} httpServer
 */
function attach(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // FIX Bug 19: Authenticate WebSocket connections via JWT in query string.
    // Frontend connects as: ws://host/ws?token=<jwt>
    const { query } = url.parse(req.url, true);
    const token = query.token;
    if (!token) {
      send(ws, { type: 'ERROR', message: 'Authentication required' });
      ws.close(4001, 'Authentication required');
      logger.warn('[WS] Rejected unauthenticated connection from ' + req.socket.remoteAddress);
      return;
    }
    try {
      ws.user = verifyJWT(token);
    } catch (err) {
      send(ws, { type: 'ERROR', message: 'Invalid or expired token' });
      ws.close(4001, 'Invalid token');
      logger.warn('[WS] Rejected invalid token: ' + err.message);
      return;
    }

    clients.add(ws);
    logger.info('[WS] Authenticated client connected (user: ' + ws.user.email + '). Total: ' + clients.size);

    ws.on('message', (raw) => handleMessage(ws, raw));

    ws.on('close', () => {
      clients.delete(ws);
      // Remove this client from all subscriptions
      for (const [symbol, subs] of subscriptions) {
        subs.delete(ws);
        if (subs.size === 0) stopPolling(symbol);
      }
      logger.info(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      logger.warn(`[WS] Client error: ${err.message}`);
      clients.delete(ws);
    });

    // Send welcome handshake
    send(ws, { type: 'CONNECTED', message: 'Systematic Trading Engine Live Feed', user: ws.user.email, ts: new Date().toISOString() });
  });

  logger.info('[WS] WebSocket server attached at /ws');
  return wss;
}

// ─── Message handling ─────────────────────────────────────────────────────────

/**
 * Handle incoming WS message from client.
 * Expected message formats:
 *   { action: 'SUBSCRIBE',   symbols: ['RELIANCE', 'INFY'] }
 *   { action: 'UNSUBSCRIBE', symbols: ['RELIANCE'] }
 *   { action: 'PING' }
 *   { action: 'GET_SIGNAL',  symbol: 'RELIANCE' }
 */
function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    send(ws, { type: 'ERROR', message: 'Invalid JSON' });
    return;
  }

  switch (msg.action) {
    case 'SUBSCRIBE':
      if (!Array.isArray(msg.symbols)) {
        send(ws, { type: 'ERROR', message: 'symbols must be an array' });
        return;
      }
      for (const symbol of msg.symbols.map(s => s.toUpperCase())) {
        subscribe(ws, symbol);
      }
      send(ws, { type: 'SUBSCRIBED', symbols: msg.symbols, ts: new Date().toISOString() });
      break;

    case 'UNSUBSCRIBE':
      for (const symbol of (msg.symbols || []).map(s => s.toUpperCase())) {
        unsubscribe(ws, symbol);
      }
      send(ws, { type: 'UNSUBSCRIBED', symbols: msg.symbols });
      break;

    case 'PING':
      send(ws, { type: 'PONG', ts: new Date().toISOString() });
      break;

    case 'GET_SIGNAL':
      handleSignalRequest(ws, msg.symbol?.toUpperCase());
      break;

    default:
      send(ws, { type: 'ERROR', message: `Unknown action: ${msg.action}` });
  }
}

// ─── Subscription management ─────────────────────────────────────────────────

function subscribe(ws, symbol) {
  if (!subscriptions.has(symbol)) {
    subscriptions.set(symbol, new Set());
  }
  subscriptions.get(symbol).add(ws);

  // Start polling if not already running
  if (!pollIntervals.has(symbol)) {
    startPolling(symbol);
  } else {
    // Immediately send last known price to new subscriber
    const last = lastPrices.get(symbol);
    if (last) send(ws, { type: 'PRICE', ...last });
  }
  logger.debug(`[WS] ${symbol} subscribed. Subscribers: ${subscriptions.get(symbol).size}`);
}

function unsubscribe(ws, symbol) {
  const subs = subscriptions.get(symbol);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) stopPolling(symbol);
  }
}

// ─── Price polling ────────────────────────────────────────────────────────────

function startPolling(symbol) {
  logger.info(`[WS] Starting price poll for ${symbol} every ${POLL_INTERVAL_MS}ms`);

  // Poll immediately then on interval
  pollSymbol(symbol);
  const timer = setInterval(() => pollSymbol(symbol), POLL_INTERVAL_MS);
  pollIntervals.set(symbol, timer);
}

function stopPolling(symbol) {
  const timer = pollIntervals.get(symbol);
  if (timer) {
    clearInterval(timer);
    pollIntervals.delete(symbol);
    subscriptions.delete(symbol);
    logger.info(`[WS] Stopped polling ${symbol}`);
  }
}

async function pollSymbol(symbol) {
  try {
    const quote = await nseFetcher.getQuote(symbol);
    const price = quote.lastPrice;

    if (!price) return;

    const tick = {
      type:      'PRICE',
      symbol,
      price,
      open:      quote.open,
      high:      quote.high,
      low:       quote.low,
      prevClose: quote.close,
      changePct: quote.changePct,
      volume:    quote.volume,
      vwap:      quote.vwap,
      ts:        new Date().toISOString(),
    };

    lastPrices.set(symbol, tick);
    broadcast(symbol, tick);

    // Check open paper positions for stop-loss / take-profit triggers
    const closeResult = await execEngine.checkAndClosePosition(symbol, price);
    if (closeResult) {
      broadcast(symbol, {
        type:    'POSITION_CLOSED',
        symbol,
        reason:  closeResult.exitReason || 'AUTO',
        price,
        pnl:     closeResult.pnl,
        ts:      new Date().toISOString(),
      });
    }

  } catch (err) {
    logger.warn(`[WS] Poll error for ${symbol}: ${err.message}`);
    // Broadcast a degraded status so clients know
    broadcast(symbol, { type: 'FEED_ERROR', symbol, error: err.message, ts: new Date().toISOString() });
  }
}

// ─── On-demand signal ─────────────────────────────────────────────────────────

async function handleSignalRequest(ws, symbol) {
  if (!symbol) {
    send(ws, { type: 'ERROR', message: 'symbol required for GET_SIGNAL' });
    return;
  }
  try {
    const bars   = await dataStore.getRecentPrices(symbol, 220);
    if (!bars || bars.length < 202) {
      send(ws, { type: 'SIGNAL_ERROR', symbol, error: 'Insufficient historical data' });
      return;
    }
    const closes = bars.map(b => b.close);
    const result = aggregator.aggregate(closes, { method: 'weighted' });
    send(ws, { type: 'SIGNAL', symbol, ...result });
  } catch (err) {
    send(ws, { type: 'SIGNAL_ERROR', symbol, error: err.message });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(symbol, payload) {
  const subs = subscriptions.get(symbol);
  if (!subs) return;
  const msg = JSON.stringify(payload);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/**
 * Broadcast a system-wide alert to ALL connected clients.
 */
function broadcastAlert(alert) {
  const msg = JSON.stringify({ type: 'ALERT', ...alert, ts: new Date().toISOString() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function getStats() {
  return {
    connectedClients: clients.size,
    activeSubscriptions: subscriptions.size,
    watchedSymbols: [...subscriptions.keys()],
    pollIntervalMs: POLL_INTERVAL_MS,
  };
}


/**
 * Broadcast any structured message to ALL connected WebSocket clients.
 * (Global broadcast — no symbol filtering.)
 * Used by liveSignalEngine for LIVE_SIGNAL and PAPER_TRADE events.
 */
function broadcastAll(payload) {
  if (clients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch (_) {}
    }
  }
}

module.exports = { attach, broadcast, broadcastAll, broadcastAlert, getStats };
