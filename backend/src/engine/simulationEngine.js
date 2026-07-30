// src/engine/simulationEngine.js — MULTI-USER
// Signals + price history: shared global (market data is same for all)
// Portfolio + trades + positions: per-user Map<userId, state>
'use strict';

const EventEmitter = require('events');
const signalEngine = require('./signalEngine');

// ── Watchlist ─────────────────────────────────────────────────────────────────
// There are deliberately no seed prices here any more. This engine used to boot
// each symbol with a hardcoded 2024 price and walk it randomly, which is how the
// dashboard came to show RELIANCE at ₹2,845 with a Bollinger band of
// ₹516–₹2,379 while the real stock traded near ₹1,293. Those numbers looked like
// market data and were not. Price history is now loaded from real stored closes;
// a symbol with no real history is reported as unavailable, never invented.
const DEFAULT_SYMBOLS = [
  'RELIANCE', 'INFY', 'TCS', 'HDFCBANK', 'ICICIBANK',
  'WIPRO', 'SBIN', 'AXISBANK', 'BAJFINANCE', 'KOTAKBANK',
];
const DEFAULT_INTERVAL = parseInt(process.env.SIM_INTERVAL_MS || '3000', 10);
const DEFAULT_CAPITAL  = parseFloat(process.env.DEFAULT_CAPITAL || '1000000');
const COMMISSION_RATE  = 0.0005;
const STOP_LOSS_PCT    = 0.025;
const TAKE_PROFIT_PCT  = 0.05;
const MAX_POSITION_PCT = 0.10;
const MIN_CONFIDENCE   = 0.45;

// ── SHARED: market state (same for all users) ─────────────────────────────────
const _priceHistory = new Map();   // symbol → number[]
const _signalCache  = new Map();   // symbol → latest signal
const _emitter      = new EventEmitter();
let _running        = false;
let _timer          = null;
let _tickCount      = 0;
let _watchlist      = [...DEFAULT_SYMBOLS];

// ── PER-USER portfolio state ───────────────────────────────────────────────────
// Map<userId|'anon', portfolioState>
const _portfolios = new Map();

function _makePortfolio(capital = DEFAULT_CAPITAL) {
  return {
    capital,
    initialCapital: capital,
    openPositions:  {},   // symbol → { qty, entryPrice, entryTime, stopLoss, takeProfit, commission }
    closedTrades:   [],
    equityCurve:    [{ t: Date.now(), equity: capital }],
    totalPnl:       0,
    tradeCount:     0,
  };
}

function _getPort(userId) {
  const key = userId ?? 'anon';
  if (!_portfolios.has(key)) _portfolios.set(key, _makePortfolio());
  return _portfolios.get(key);
}

// ── Real price history ────────────────────────────────────────────────────────
// Indicators are only meaningful over a real series. MIN_BARS is 60 because the
// slowest indicator in play is the 50-period SMA — fewer bars and SMA50 is
// either null or computed over a window that does not exist.
const MIN_BARS      = 60;
const HISTORY_BARS  = 250;
const RELOAD_TICKS  = 20;          // retry an unavailable symbol every ~60s

const _unavailable  = new Map();   // symbol → { reason, bars, since }
const _loading      = new Set();

/**
 * Load a symbol's real daily closes from storage.
 *
 * Returns the close array, or null when there genuinely is not enough real
 * data. Returning null is the point: the caller must then report the symbol as
 * unavailable rather than substituting numbers of its own.
 */
async function _loadHistory(symbol) {
  const sym = symbol.toUpperCase();
  if (_loading.has(sym)) return null;
  _loading.add(sym);
  try {
    // dataStore applies corporate-action adjustment, so these closes are already
    // back-adjusted and directly comparable with today's live price.
    const dataStore = require('../data/dataStore');
    const bars = await dataStore.getRecentPrices(sym, HISTORY_BARS);
    const closes = (bars || [])
      .map(b => Number(b.close))
      .filter(c => Number.isFinite(c) && c > 0);

    if (closes.length < MIN_BARS) {
      _unavailable.set(sym, {
        reason: 'INSUFFICIENT_HISTORY',
        bars:   closes.length,
        since:  Date.now(),
      });
      return null;
    }
    _unavailable.delete(sym);
    return closes;
  } catch (e) {
    _unavailable.set(sym, { reason: 'HISTORY_LOAD_FAILED', detail: e.message, since: Date.now() });
    return null;
  } finally {
    _loading.delete(sym);
  }
}

/** Symbols currently excluded from ticks, with the reason why. */
function getUnavailable() {
  return Array.from(_unavailable.entries()).map(([symbol, v]) => ({ symbol, ...v }));
}

function _generateSignal(symbol, prices) {
  const result = signalEngine.computeSignal(symbol, prices);
  const { sma20, sma50 } = result;
  const regime = sma20 && sma50
    ? (Math.abs(sma20 - sma50) / sma50 > 0.015 ? 'TRENDING' : 'MEAN_REVERTING')
    : 'UNKNOWN';
  return { ...result, regime };
}

// ── Corporate-action adjustment for OPEN positions ────────────────────────────
// corporateActions.js back-adjusts CANDLES, but an open paper position keeps the
// entry price it was opened at. After a split/bonus the live price halves while
// the stored entry price does not — producing a phantom ~50% "loss" (observed:
// RELIANCE entry ₹2,606 vs post-bonus price ₹1,281 = −50.86% that never
// happened; the shares doubled instead).
//
// Correct treatment for a price factor f (1:1 bonus → f = 0.5):
//   entryPrice × f   (and stop/target with it),   qty ÷ f
// Position VALUE is unchanged — only the share count and per-share basis move.
async function adjustOpenPositionsForActions(userId = null) {
  let corp;
  try { corp = require('../data/corporateActions'); } catch { return { adjusted: 0 }; }
  const p = _getPort(userId);
  let adjusted = 0;
  for (const [symbol, pos] of Object.entries(p.openPositions || {})) {
    if (!pos?.entryTime || !(pos.entryPrice > 0)) continue;
    let actions = [];
    try { actions = await corp.getActions(symbol); } catch { continue; }
    // Only actions whose ex-date falls AFTER we opened the position.
    const openedOn = String(pos.entryTime).slice(0, 10);
    const pending = actions.filter(a => a.ex_date > openedOn && !(pos.adjustedFor || []).includes(a.ex_date));
    if (!pending.length) continue;
    const factor = pending.reduce((f, a) => f * Number(a.factor), 1);
    if (!(factor > 0) || factor === 1) continue;

    const oldQty = pos.qty, oldEntry = pos.entryPrice;
    pos.entryPrice = parseFloat((oldEntry * factor).toFixed(4));
    pos.qty        = Math.round(oldQty / factor);
    if (pos.stopLoss)   pos.stopLoss   = parseFloat((pos.stopLoss * factor).toFixed(2));
    if (pos.takeProfit) pos.takeProfit = parseFloat((pos.takeProfit * factor).toFixed(2));
    pos.adjustedFor = [...(pos.adjustedFor || []), ...pending.map(a => a.ex_date)];
    adjusted++;
    console.log(`[SimEngine] Corp-action adjust ${symbol}: ${oldQty}@₹${oldEntry} → ${pos.qty}@₹${pos.entryPrice} (factor ${factor})`);
  }
  return { adjusted };
}

// ── Per-user trade execution ──────────────────────────────────────────────────
function _placeBuy(userId, symbol, price) {
  const p = _getPort(userId);
  const maxValue = p.capital * MAX_POSITION_PCT;
  const qty      = Math.floor(maxValue / price);
  if (qty < 1) return null;
  const cost = qty * price, commission = cost * COMMISSION_RATE, total = cost + commission;
  if (total > p.capital) return null;

  p.capital -= total;
  p.openPositions[symbol] = {
    qty, entryPrice: price, entryTime: new Date().toISOString(),
    stopLoss:   parseFloat((price * (1 - STOP_LOSS_PCT)).toFixed(2)),
    takeProfit: parseFloat((price * (1 + TAKE_PROFIT_PCT)).toFixed(2)),
    commission,
  };
  const trade = { id: ++p.tradeCount, symbol, side:'BUY', qty, price:parseFloat(price.toFixed(2)),
    total:parseFloat(total.toFixed(2)), commission:parseFloat(commission.toFixed(2)),
    pnl:null, reason:'SIGNAL', ts:new Date().toISOString(), userId };
  _emitter.emit('trade', trade, userId);
  return trade;
}

function _placeSell(userId, symbol, price, reason = 'SIGNAL') {
  const p = _getPort(userId);
  const pos = p.openPositions[symbol];
  if (!pos) return null;

  const proceeds = pos.qty * price, commission = proceeds * COMMISSION_RATE;
  const net = proceeds - commission;
  const pnl = parseFloat((net - (pos.qty * pos.entryPrice + pos.commission)).toFixed(2));

  p.capital += net;
  p.totalPnl = parseFloat((p.totalPnl + pnl).toFixed(2));
  delete p.openPositions[symbol];

  // Carry the OPEN time onto the closed trade so the history can show when the
  // position was opened, when it closed, and how long it was held — a trade log
  // without entry time can't answer "how long do my winners run?".
  const exitTs = new Date().toISOString();
  const holdMs = pos.entryTime ? (new Date(exitTs) - new Date(pos.entryTime)) : null;
  const trade = { id:++p.tradeCount, symbol, side:'SELL', qty:pos.qty,
    price:parseFloat(price.toFixed(2)), entryPrice:parseFloat(pos.entryPrice.toFixed(2)),
    total:parseFloat(net.toFixed(2)), commission:parseFloat(commission.toFixed(2)),
    pnl, pnlPct: pos.entryPrice > 0 ? parseFloat((((price - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2)) : null,
    reason, entryTime: pos.entryTime || null, ts: exitTs, holdMs, userId };

  p.closedTrades.unshift(trade);
  if (p.closedTrades.length > 200) p.closedTrades.pop();
  _emitter.emit('trade', trade, userId);
  return trade;
}

function _checkExits(userId, symbol, price) {
  const p = _getPort(userId);
  const pos = p.openPositions[symbol];
  if (!pos) return;
  if (price <= pos.stopLoss)   _placeSell(userId, symbol, price, 'STOP_LOSS');
  else if (price >= pos.takeProfit) _placeSell(userId, symbol, price, 'TAKE_PROFIT');
}

// ── Tick (runs for ALL users) ─────────────────────────────────────────────────
async function _tick() {
  _tickCount++;
  const signals = [];

  for (const symbol of _watchlist) {
    // Load real history on first use, and retry periodically for symbols that
    // were unavailable (the daily sync may have filled them in since).
    if (!_priceHistory.has(symbol)) {
      const u = _unavailable.get(symbol);
      const shouldRetry = !u || _tickCount % RELOAD_TICKS === 0;
      if (shouldRetry) {
        const closes = await _loadHistory(symbol);
        if (closes) _priceHistory.set(symbol, closes);
      }
    }

    const history = _priceHistory.get(symbol);
    // No real series → emit nothing for this symbol. A missing card is honest;
    // a card full of invented indicators is not.
    if (!history) continue;

    try {
      const sig = await signalEngine.generateLiveSignal(symbol, history);
      const { sma20, sma50 } = sig;
      sig.regime = sma20 && sma50
        ? (Math.abs(sma20-sma50)/sma50 > 0.015 ? 'TRENDING' : 'MEAN_REVERTING')
        : 'UNKNOWN';
      _signalCache.set(symbol, sig);
      signals.push(sig);

      const curPrice = history[history.length - 1];

      // Apply signal to EACH user's portfolio independently
      for (const [key] of _portfolios) {
        const userId = key === 'anon' ? null : key;
        const p = _portfolios.get(key);
        _checkExits(userId, symbol, curPrice);
        if (sig.signal === 'BUY' && sig.confidence >= MIN_CONFIDENCE && !p.openPositions[symbol]) {
          _placeBuy(userId, symbol, curPrice);
        } else if (sig.signal === 'SELL' && p.openPositions[symbol]) {
          _placeSell(userId, symbol, curPrice, 'SIGNAL');
        }
      }
    } catch (err) {
      // Previously this invented the next price and pushed a signal labelled
      // SIM. A failed tick is not a market event — drop it and keep the last
      // good signal in the cache rather than manufacturing a new one.
      console.error(`[SimEngine] tick error ${symbol}: ${err.message}`);
    }
  }

  // Update equity curves for all users
  if (_tickCount % 5 === 0) {
    for (const [key, p] of _portfolios) {
      const openPnl = Object.entries(p.openPositions).reduce((sum, [sym, pos]) => {
        const h = _priceHistory.get(sym);
        const cur = h ? h[h.length-1] : pos.entryPrice;
        return sum + (cur - pos.entryPrice) * pos.qty;
      }, 0);
      const equity = parseFloat((p.capital + openPnl).toFixed(2));
      p.equityCurve.push({ t: Date.now(), equity });
      if (p.equityCurve.length > 500) p.equityCurve.shift();
    }
  }

  // Broadcast signals to all; portfolio broadcast handled per-user in liveDataFeed
  _emitter.emit('tick', signals);
  return signals;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
function start(opts = {}) {
  if (_running) return;
  if (opts.watchlist) _watchlist = opts.watchlist.map(s => s.toUpperCase());
  const interval = opts.intervalMs || DEFAULT_INTERVAL;
  _running = true;

  // History is loaded lazily inside _tick() — it needs the DB, which may not be
  // connected yet at boot, and a symbol that is empty now may be filled by the
  // daily sync later.

  try {
    const ldf = require('../data/liveDataFeed');
    _emitter.on('tick', (signals) => {
      try {
        // Broadcast signals to all (public market data)
        ldf.broadcastAll({ type: 'SIM_TICK', data: { signals }, ts: Date.now() });
      } catch(_) {}
    });
    _emitter.on('trade', (trade, userId) => {
      try {
        // Trade events → only to that user's WS connection
        if (userId) ldf.broadcastToUser(userId, { type: 'SIM_TRADE', data: trade, ts: Date.now() });
        else        ldf.broadcastAll({ type: 'SIM_TRADE', data: trade, ts: Date.now() });
      } catch(_) {}
    });
  } catch(_) {}

  _tick().catch(console.error);
  _timer = setInterval(() => _tick().catch(console.error), interval);
  console.log(`[SimEngine] Started | symbols=${_watchlist.length} | interval=${interval}ms`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running = false;
  console.log('[SimEngine] Stopped');
}

// ── Per-user public getters ───────────────────────────────────────────────────
function getPortfolioState(userId = null) {
  const p = _getPort(userId);
  const openPositions = {};
  let openPnl = 0;
  for (const [sym, pos] of Object.entries(p.openPositions)) {
    const h = _priceHistory.get(sym);
    const cur = h ? h[h.length-1] : pos.entryPrice;
    const unrealizedPnl = parseFloat(((cur - pos.entryPrice) * pos.qty).toFixed(2));
    openPnl += unrealizedPnl;
    openPositions[sym] = { ...pos, currentPrice: parseFloat(cur.toFixed(2)), unrealizedPnl };
  }
  const equity = parseFloat((p.capital + openPnl).toFixed(2));
  const totalReturn = parseFloat(((equity - p.initialCapital) / p.initialCapital * 100).toFixed(2));
  return {
    capital: parseFloat(p.capital.toFixed(2)),
    initialCapital: p.initialCapital,
    equity, openPnl: parseFloat(openPnl.toFixed(2)),
    totalPnl: p.totalPnl, totalReturn,
    openPositions, openPositionCount: Object.keys(p.openPositions).length,
  };
}

function getRecentTrades(limit = 30, userId = null) {
  return _getPort(userId).closedTrades.slice(0, limit);
}

function getEquityCurve(userId = null) {
  return _getPort(userId).equityCurve;
}

function initUserPortfolio(userId, capital = DEFAULT_CAPITAL) {
  const key = userId ?? 'anon';
  _portfolios.set(key, _makePortfolio(capital));
  console.log(`[SimEngine] Portfolio init user=${key} capital=₹${capital}`);
}

function resetUserPortfolio(userId) {
  const key = userId ?? 'anon';
  const existing = _portfolios.get(key);
  const capital = existing?.initialCapital ?? DEFAULT_CAPITAL;
  _portfolios.set(key, _makePortfolio(capital));
}

// ── Shared getters ────────────────────────────────────────────────────────────
function getLatestSignals(symbols = null) {
  if (symbols) return symbols.map(s => _signalCache.get(s.toUpperCase()) || { symbol: s, signal: null });
  return [..._signalCache.values()];
}

function getStatus() {
  return { running: _running, tickCount: _tickCount, watchlist: _watchlist,
    signalCache: _signalCache.size, activeUsers: _portfolios.size,
    priced: _priceHistory.size, unavailable: getUnavailable(),
    mode: 'REAL_HISTORY' };
}

function addSymbol(symbol) {
  const sym = symbol.toUpperCase();
  if (!_watchlist.includes(sym)) {
    _watchlist.push(sym);
    // No seed price is assigned. If the symbol has no stored history it simply
    // reports as unavailable until the data sync provides one.
    return true;
  }
  return false;
}

function removeSymbol(symbol) {
  const sym = symbol.toUpperCase();
  const idx = _watchlist.indexOf(sym);
  if (idx !== -1) { _watchlist.splice(idx, 1); _signalCache.delete(sym); return true; }
  return false;
}

function getPriceHistory(symbol) {
  return _priceHistory.get(symbol.toUpperCase()) || [];
}

/** Load a symbol's real history on demand (used by the signal API). */
async function ensureHistory(symbol) {
  const sym = symbol.toUpperCase();
  if (_priceHistory.has(sym)) return _priceHistory.get(sym);
  const closes = await _loadHistory(sym);
  if (closes) _priceHistory.set(sym, closes);
  return closes;
}

const on  = (event, cb) => _emitter.on(event, cb);
const off = (event, cb) => _emitter.off(event, cb);

module.exports = {
  start, stop,
  getLatestSignals, getPortfolioState, getRecentTrades, getEquityCurve, getStatus,
  adjustOpenPositionsForActions,
  initUserPortfolio, resetUserPortfolio,
  addSymbol, removeSymbol, getPriceHistory, ensureHistory, getUnavailable,
  on, off,
};
