// src/engine/simulationEngine.js — MULTI-USER
// Signals + price history: shared global (market data is same for all)
// Portfolio + trades + positions: per-user Map<userId, state>
'use strict';

const EventEmitter = require('events');
const signalEngine = require('./signalEngine');

// ── Seed prices ───────────────────────────────────────────────────────────────
const SEED_PRICES = {
  RELIANCE:2850, INFY:1620, TCS:4200, HDFCBANK:1720, ICICIBANK:1180,
  WIPRO:560, SBIN:810, AXISBANK:1190, BAJFINANCE:6800, MARUTI:12500,
  TATAMOTORS:960, SUNPHARMA:1650, TECHM:1740, TITAN:3450, ULTRACEMCO:10200,
  LT:3700, HINDUNILVR:2480, KOTAKBANK:1940, ASIANPAINT:2850, ONGC:290,
};

const DEFAULT_SYMBOLS  = Object.keys(SEED_PRICES).slice(0, 10);
const DEFAULT_INTERVAL = parseInt(process.env.SIM_INTERVAL_MS || '3000', 10);
const DEFAULT_CAPITAL  = parseFloat(process.env.DEFAULT_CAPITAL || '1000000');
const VOLATILITY       = 0.012;
const DRIFT            = 0.0003;
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

// ── PRNG helpers ──────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function symbolSeed(symbol) {
  return symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 1337;
}

// ── Price simulation ──────────────────────────────────────────────────────────
function _generateHistory(symbol) {
  const rng = mulberry32(symbolSeed(symbol));
  const start = SEED_PRICES[symbol] || 1000;
  const prices = [start];
  for (let i = 1; i < 250; i++) {
    const u1 = rng(), u2 = rng();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    prices.push(Math.max(prices[i-1] * (1 + DRIFT + VOLATILITY * z), 1));
  }
  return prices;
}

function _nextPrice(prev, regime) {
  const vol = regime === 'TRENDING' ? VOLATILITY*1.4 : regime === 'VOLATILE' ? VOLATILITY*2 : VOLATILITY;
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return Math.max(prev * (1 + DRIFT + vol * z), 1);
}

function _generateSignal(symbol, prices) {
  const result = signalEngine.computeSignal(symbol, prices);
  const { sma20, sma50 } = result;
  const regime = sma20 && sma50
    ? (Math.abs(sma20 - sma50) / sma50 > 0.015 ? 'TRENDING' : 'MEAN_REVERTING')
    : 'UNKNOWN';
  return { ...result, regime };
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

  const trade = { id:++p.tradeCount, symbol, side:'SELL', qty:pos.qty,
    price:parseFloat(price.toFixed(2)), entryPrice:parseFloat(pos.entryPrice.toFixed(2)),
    total:parseFloat(net.toFixed(2)), commission:parseFloat(commission.toFixed(2)),
    pnl, reason, ts:new Date().toISOString(), userId };

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
    if (!_priceHistory.has(symbol)) _priceHistory.set(symbol, _generateHistory(symbol));
    const history = _priceHistory.get(symbol);

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
      console.error(`[SimEngine] tick error ${symbol}: ${err.message}`);
      const last = history[history.length - 1];
      history.push(_nextPrice(last, 'UNKNOWN'));
      if (history.length > 500) history.shift();
      const sig = _generateSignal(symbol, history);
      sig.source = 'SIM';
      _signalCache.set(symbol, sig);
      signals.push(sig);
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

  for (const sym of _watchlist) {
    if (!_priceHistory.has(sym)) _priceHistory.set(sym, _generateHistory(sym));
  }

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
    signalCache: _signalCache.size, activeUsers: _portfolios.size, mode: 'SIMULATION' };
}

function addSymbol(symbol) {
  const sym = symbol.toUpperCase();
  if (!_watchlist.includes(sym)) {
    _watchlist.push(sym);
    if (!SEED_PRICES[sym]) SEED_PRICES[sym] = 500 + Math.floor(Math.random() * 2000);
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

const on  = (event, cb) => _emitter.on(event, cb);
const off = (event, cb) => _emitter.off(event, cb);

module.exports = {
  start, stop,
  getLatestSignals, getPortfolioState, getRecentTrades, getEquityCurve, getStatus,
  initUserPortfolio, resetUserPortfolio,
  addSymbol, removeSymbol, getPriceHistory,
  on, off, SEED_PRICES,
};
