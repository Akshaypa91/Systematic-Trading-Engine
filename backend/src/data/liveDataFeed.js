// src/data/liveDataFeed.js — HARDENED
// WebSocket Live Data Feed Manager
//
// Auth policy:
//   • Authenticated clients (JWT in ?token=) → full access + private events
//   • Unauthenticated clients → sim ticks + market prices only (no PII)
//   This allows the frontend to render live signals before the user logs in,
//   while keeping portfolio and trade events auth-gated.
'use strict';

const WebSocket   = require('ws');
const marketDataService = require('../services/marketDataService');
const aggregator  = require('../strategies/aggregator');
const dataStore   = require('./dataStore');
const execEngine  = require('../engine/executionEngine');
const logger      = require('../config/logger');

let _verifyJWT = null;
function getVerify() {
  if (!_verifyJWT) {
    try { _verifyJWT = require('../controllers/authController').verifyJWT; } catch (_) {}
  }
  return _verifyJWT;
}

// ── State ─────────────────────────────────────────────────────────────────────
const subscriptions = new Map();   // symbol → Set<WebSocket>
const lastPrices    = new Map();   // symbol → tick object
const pollIntervals = new Map();   // symbol → timer
const clients       = new Set();   // all connected WS clients
const authClients   = new Set();   // authenticated-only clients

const POLL_INTERVAL_MS = parseInt(process.env.LIVE_POLL_INTERVAL_MS || '5000', 10);

// ── Attach ────────────────────────────────────────────────────────────────────
function attach(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // WHATWG URL — replaces deprecated url.parse()
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token  = reqUrl.searchParams.get('token');

    ws.isAuthenticated = false;
    ws.user            = null;

    if (token) {
      try {
        const verify = getVerify();
        if (verify) {
          ws.user            = verify(token);
          ws.isAuthenticated = true;
        }
      } catch (err) {
        logger.warn(`[WS] Invalid token: ${err.message} — downgrading to anonymous`);
        // Notify the client so it clears stale token from localStorage
        // (send after open — can't send before connection is established)
        ws._notifyBadToken = true;
      }
    }

    clients.add(ws);
    if (ws.isAuthenticated) authClients.add(ws);

    const mode = ws.isAuthenticated ? `auth:${ws.user?.email}` : 'anonymous';
    logger.info(`[WS] Client connected (${mode}). Total: ${clients.size}`);

    ws.on('message', (raw) => {
      try { handleMessage(ws, raw); } catch (e) { logger.warn(`[WS] message handler: ${e.message}`); }
    });

    ws.on('close', () => {
      clients.delete(ws);
      authClients.delete(ws);
      for (const [sym, subs] of subscriptions) {
        subs.delete(ws);
        if (subs.size === 0) stopPolling(sym);
      }
      logger.info(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      logger.debug(`[WS] Client error: ${err.message}`);
      clients.delete(ws); authClients.delete(ws);
    });

    send(ws, {
      type:            'CONNECTED',
      message:         'Systematic Trading Engine Live Feed',
      authenticated:   ws.isAuthenticated,
      user:            ws.user?.email ?? null,
      ts:              new Date().toISOString(),
    });

    // If token was present but invalid, tell client to clear it
    if (ws._notifyBadToken) {
      send(ws, { type: 'TOKEN_INVALID', message: 'Token signature invalid — please log in again' });
    }
  });

  logger.info('[WS] WebSocket server attached at /ws');
  return wss;
}

// ── Message handling ──────────────────────────────────────────────────────────
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { send(ws, { type: 'ERROR', message: 'Invalid JSON' }); return; }

  switch (msg.action) {
    case 'SUBSCRIBE': {
      if (!Array.isArray(msg.symbols)) { send(ws, { type: 'ERROR', message: 'symbols must be an array' }); return; }
      for (const sym of msg.symbols.map(s => s.toUpperCase())) subscribe(ws, sym);
      send(ws, { type: 'SUBSCRIBED', symbols: msg.symbols, ts: new Date().toISOString() });
      break;
    }
    case 'UNSUBSCRIBE': {
      for (const sym of (msg.symbols || []).map(s => s.toUpperCase())) unsubscribe(ws, sym);
      send(ws, { type: 'UNSUBSCRIBED', symbols: msg.symbols });
      break;
    }
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

// ── Subscription management ───────────────────────────────────────────────────
function subscribe(ws, symbol) {
  if (!subscriptions.has(symbol)) subscriptions.set(symbol, new Set());
  subscriptions.get(symbol).add(ws);
  if (!pollIntervals.has(symbol)) {
    startPolling(symbol);
  } else {
    const last = lastPrices.get(symbol);
    if (last) send(ws, last);
  }
}

function unsubscribe(ws, symbol) {
  const subs = subscriptions.get(symbol);
  if (subs) { subs.delete(ws); if (subs.size === 0) stopPolling(symbol); }
}

// ── Price polling ─────────────────────────────────────────────────────────────
function startPolling(symbol) {
  pollSymbol(symbol);
  const timer = setInterval(() => pollSymbol(symbol), POLL_INTERVAL_MS);
  pollIntervals.set(symbol, timer);
}

function stopPolling(symbol) {
  const timer = pollIntervals.get(symbol);
  if (timer) { clearInterval(timer); pollIntervals.delete(symbol); subscriptions.delete(symbol); }
}

async function pollSymbol(symbol) {
  try {
    const result = await marketDataService.getLivePrice(symbol);
    const price  = result.price;
    if (!price || !isFinite(price)) return;

    const tick = {
      type:   'PRICE',
      symbol,
      price,
      source: result.source,
      ts:     new Date().toISOString(),
    };

    lastPrices.set(symbol, tick);
    broadcast(symbol, tick);

    // Check SL/TP — only affects authenticated (real portfolio)
    if (authClients.size > 0) {
      const closeResult = await execEngine.checkAndClosePosition(symbol, price);
      if (closeResult) {
        broadcastAuth({
          type:   'POSITION_CLOSED',
          symbol,
          reason: closeResult.exitReason || 'AUTO',
          price,
          pnl:    closeResult.pnl,
          ts:     new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    logger.debug(`[WS] Poll error ${symbol}: ${err.message}`);
    broadcast(symbol, { type: 'FEED_ERROR', symbol, error: err.message, ts: new Date().toISOString() });
  }
}

// ── Signal on-demand ──────────────────────────────────────────────────────────
async function handleSignalRequest(ws, symbol) {
  if (!symbol) { send(ws, { type: 'ERROR', message: 'symbol required' }); return; }
  try {
    const bars = await dataStore.getRecentPrices(symbol, 220);
    if (!bars || bars.length < 50) { send(ws, { type: 'SIGNAL_ERROR', symbol, error: 'Insufficient data' }); return; }
    const closes = bars.map(b => b.close);
    const result = aggregator.aggregate(closes, { method: 'weighted' });
    send(ws, { type: 'SIGNAL', symbol, ...result });
  } catch (err) {
    send(ws, { type: 'SIGNAL_ERROR', symbol, error: err.message });
  }
}

// ── Send / broadcast helpers ──────────────────────────────────────────────────
function send(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch (_) {}
}

function broadcast(symbol, payload) {
  const subs = subscriptions.get(symbol);
  if (!subs?.size) return;
  const msg = JSON.stringify(payload);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) { try { ws.send(msg); } catch (_) {} }
  }
}

/** Broadcast to ALL clients (authenticated + anonymous). Used by sim engine. */
function broadcastAll(payload) {
  if (!clients.size) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) { try { ws.send(msg); } catch (_) {} }
  }
}

/** Broadcast only to authenticated clients. Used for private portfolio events. */
function broadcastAuth(payload) {
  if (!authClients.size) return;
  const msg = JSON.stringify(payload);
  for (const ws of authClients) {
    if (ws.readyState === WebSocket.OPEN) { try { ws.send(msg); } catch (_) {} }
  }
}

function broadcastAlert(alert) {
  broadcastAll({ type: 'ALERT', ...alert, ts: new Date().toISOString() });
}

function getStats() {
  return {
    connectedClients:    clients.size,
    authenticatedClients:authClients.size,
    activeSubscriptions: subscriptions.size,
    watchedSymbols:      [...subscriptions.keys()],
    pollIntervalMs:      POLL_INTERVAL_MS,
  };
}

module.exports = { attach, broadcast, broadcastAll, broadcastAuth, broadcastAlert, getStats };
