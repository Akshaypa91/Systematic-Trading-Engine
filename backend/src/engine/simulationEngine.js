// src/engine/simulationEngine.js
// ─────────────────────────────────────────────────────────────────────────────
//
// SIMULATION MODE — No DB, No NSE required
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates realistic price movements + signals for paper trading without
// needing MySQL or NSE API access. Uses:
//   • Geometric Brownian Motion for price simulation
//   • Real technical indicator logic (RSI, MA, Bollinger)
//   • Deterministic seed per symbol for reproducible sessions
//
// DROP-IN replacement for liveSignalEngine when DB is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const EventEmitter = require('events');
const signalEngine = require('./signalEngine');

// ── NSE Nifty50 seed prices (approximate, realistic INR values) ───────────────
const SEED_PRICES = {
  RELIANCE:   2850,  INFY:        1620,  TCS:         4200,  HDFCBANK:    1720,
  ICICIBANK:   1180,  WIPRO:        560,  SBIN:         810,  AXISBANK:    1190,
  BAJFINANCE: 6800,  MARUTI:     12500,  TATAMOTORS:   960,  SUNPHARMA:  1650,
  TECHM:      1740,  TITAN:       3450,  ULTRACEMCO:  10200, LT:         3700,
  HINDUNILVR: 2480,  KOTAKBANK:  1940,  ASIANPAINT:  2850,  ONGC:        290,
};

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_SYMBOLS   = Object.keys(SEED_PRICES).slice(0, 10);
const DEFAULT_INTERVAL  = parseInt(process.env.SIM_INTERVAL_MS || '5000', 10);  // 5s
const VOLATILITY        = 0.012;   // daily vol (~1.2%)
const DRIFT             = 0.0003;  // slight upward drift
const INITIAL_CAPITAL   = parseFloat(process.env.DEFAULT_CAPITAL || '1000000');

// ── In-memory price history per symbol ───────────────────────────────────────
// We maintain a rolling 250-bar history so indicators have enough lookback
const _priceHistory = new Map();   // symbol → number[]
const _signalCache  = new Map();   // symbol → latest signal object
const _emitter      = new EventEmitter();

// ── Paper portfolio state ─────────────────────────────────────────────────────
const _portfolio = {
  capital:        INITIAL_CAPITAL,
  initialCapital: INITIAL_CAPITAL,
  openPositions:  {},   // symbol → { qty, entryPrice, entryTime, stopLoss, takeProfit }
  closedTrades:   [],   // completed trades
  equityCurve:    [{ t: Date.now(), equity: INITIAL_CAPITAL }],
  totalPnl:       0,
  tradeCount:     0,
};

// ── Engine state ──────────────────────────────────────────────────────────────
let _running     = false;
let _timer       = null;
let _tickCount   = 0;
let _watchlist   = [...DEFAULT_SYMBOLS];

// ── Seeded PRNG (Mulberry32) for per-symbol reproducible random walk ──────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Map symbol to a fixed seed for session-consistent price paths
function symbolSeed(symbol) {
  return symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 1337;
}

// ── Price simulation ──────────────────────────────────────────────────────────

// Generate the initial price history (250 bars) for a symbol using GBM
function _generateHistory(symbol) {
  const rng     = mulberry32(symbolSeed(symbol));
  const start   = SEED_PRICES[symbol] || 1000;
  const prices  = [start];

  for (let i = 1; i < 250; i++) {
    const u1 = rng(), u2 = rng();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller
    const ret = DRIFT + VOLATILITY * z;
    prices.push(Math.max(prices[i - 1] * (1 + ret), 1));
  }
  return prices;
}

// Generate the next price tick with regime-sensitive volatility
function _nextPrice(prevPrice, regime) {
  const vol  = regime === 'TRENDING' ? VOLATILITY * 1.4 :
               regime === 'VOLATILE' ? VOLATILITY * 2.0 : VOLATILITY;
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return Math.max(prevPrice * (1 + DRIFT + vol * z), 1);
}

// ── Technical indicators (pure JS, no deps) ───────────────────────────────────

function _sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function _ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function _rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(-period - 1).map((p, i, arr) =>
    i === 0 ? 0 : p - arr[i - 1]
  ).slice(1);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function _bollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd   = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd, sd };
}

// ── Signal generation (delegated to signalEngine.js) ─────────────────────────

function _generateSignal(symbol, prices) {
  const result = signalEngine.computeSignal(symbol, prices);
  const sma20  = result.sma20;
  const sma50  = result.sma50;
  const regime = (sma20 !== null && sma50 !== null)
    ? (Math.abs(sma20 - sma50) / sma50 > 0.015 ? 'TRENDING' : 'MEAN_REVERTING')
    : 'UNKNOWN';
  return { ...result, regime };
}

// ── DEAD CODE BELOW — kept for reference only, no longer called ───────────────
function _generateSignal_LEGACY(symbol, prices) {
  const price   = prices[prices.length - 1];
  const rsi     = _rsi(prices);
  const sma20   = _sma(prices, 20);
  const sma50   = _sma(prices, 50);
  const ema12   = _ema(prices, 12);
  const ema26   = _ema(prices, 26);
  const bb      = _bollingerBands(prices);

  let buyScore  = 0;
  let sellScore = 0;
  const components = {};

  // RSI strategy
  if (rsi !== null) {
    if (rsi < 30)       { buyScore  += 0.35; components.rsi = 'oversold'; }
    else if (rsi < 40)  { buyScore  += 0.15; components.rsi = 'near_oversold'; }
    else if (rsi > 70)  { sellScore += 0.35; components.rsi = 'overbought'; }
    else if (rsi > 60)  { sellScore += 0.15; components.rsi = 'near_overbought'; }
    else                { components.rsi = 'neutral'; }
  }

  // MA Crossover
  if (sma20 && sma50) {
    const cross = (sma20 - sma50) / sma50;
    if (cross > 0.01)       { buyScore  += 0.30; components.ma = 'golden_cross'; }
    else if (cross > 0)     { buyScore  += 0.10; components.ma = 'bullish'; }
    else if (cross < -0.01) { sellScore += 0.30; components.ma = 'death_cross'; }
    else                    { sellScore += 0.10; components.ma = 'bearish'; }
  }

  // Bollinger Bands (mean reversion)
  if (bb) {
    if (price < bb.lower)       { buyScore  += 0.35; components.bb = 'below_lower'; }
    else if (price < bb.middle) { buyScore  += 0.10; components.bb = 'lower_half'; }
    else if (price > bb.upper)  { sellScore += 0.35; components.bb = 'above_upper'; }
    else                        { components.bb = 'within_bands'; }
  }

  // MACD (EMA12 vs EMA26)
  if (ema12 && ema26) {
    const macd = ema12 - ema26;
    if (macd > 0) { buyScore  += 0.10; components.macd = 'positive'; }
    else          { sellScore += 0.10; components.macd = 'negative'; }
  }

  // Regime detection (simple trend strength)
  const regime = sma20 && sma50
    ? (Math.abs(sma20 - sma50) / sma50 > 0.015 ? 'TRENDING' : 'MEAN_REVERTING')
    : 'UNKNOWN';

  const total      = buyScore + sellScore || 1;
  let signal       = 'HOLD';
  let confidence   = 0;

  if (buyScore > sellScore && buyScore > 0.30) {
    signal     = 'BUY';
    confidence = Math.min(buyScore / total, 0.95);
  } else if (sellScore > buyScore && sellScore > 0.30) {
    signal     = 'SELL';
    confidence = Math.min(sellScore / total, 0.95);
  } else {
    confidence = 1 - Math.abs(buyScore - sellScore) / total;
  }

  return {
    symbol,
    signal,
    confidence: parseFloat(confidence.toFixed(4)),
    currentPrice: parseFloat(price.toFixed(2)),
    rsi:       rsi   ? parseFloat(rsi.toFixed(2))   : null,
    sma20:     sma20 ? parseFloat(sma20.toFixed(2)) : null,
    sma50:     sma50 ? parseFloat(sma50.toFixed(2)) : null,
    bbUpper:   bb    ? parseFloat(bb.upper.toFixed(2)) : null,
    bbLower:   bb    ? parseFloat(bb.lower.toFixed(2)) : null,
    regime,
    components,
    timestamp: new Date().toISOString(),
  };
}
// ── END LEGACY ─────────────────────────────────────────────────────────────────

// ── Paper trading execution ───────────────────────────────────────────────────

const COMMISSION_RATE  = 0.0005;   // 0.05% round trip
const STOP_LOSS_PCT    = 0.025;    // 2.5%
const TAKE_PROFIT_PCT  = 0.05;     // 5%
const MAX_POSITION_PCT = 0.10;     // 10% of capital per trade
const MIN_CONFIDENCE   = 0.45;

function _placeBuy(symbol, price) {
  const maxValue = _portfolio.capital * MAX_POSITION_PCT;
  const qty      = Math.floor(maxValue / price);
  if (qty < 1) return null;

  const cost       = qty * price;
  const commission = cost * COMMISSION_RATE;
  const total      = cost + commission;

  if (total > _portfolio.capital) return null;

  _portfolio.capital -= total;
  _portfolio.openPositions[symbol] = {
    qty,
    entryPrice: price,
    entryTime:  new Date().toISOString(),
    stopLoss:   parseFloat((price * (1 - STOP_LOSS_PCT)).toFixed(2)),
    takeProfit: parseFloat((price * (1 + TAKE_PROFIT_PCT)).toFixed(2)),
    commission,
  };

  const trade = {
    id:        ++_portfolio.tradeCount,
    symbol,
    side:      'BUY',
    qty,
    price:     parseFloat(price.toFixed(2)),
    total:     parseFloat(total.toFixed(2)),
    commission:parseFloat(commission.toFixed(2)),
    pnl:       null,
    reason:    'SIGNAL',
    ts:        new Date().toISOString(),
  };

  _emitter.emit('trade', trade);
  return trade;
}

function _placeSell(symbol, price, reason = 'SIGNAL') {
  const pos = _portfolio.openPositions[symbol];
  if (!pos) return null;

  const proceeds   = pos.qty * price;
  const commission = proceeds * COMMISSION_RATE;
  const net        = proceeds - commission;
  const pnl        = net - (pos.qty * pos.entryPrice + pos.commission);

  _portfolio.capital += net;
  _portfolio.totalPnl = parseFloat((_portfolio.totalPnl + pnl).toFixed(2));
  delete _portfolio.openPositions[symbol];

  const trade = {
    id:        ++_portfolio.tradeCount,
    symbol,
    side:      'SELL',
    qty:       pos.qty,
    price:     parseFloat(price.toFixed(2)),
    entryPrice:parseFloat(pos.entryPrice.toFixed(2)),
    total:     parseFloat(net.toFixed(2)),
    commission:parseFloat(commission.toFixed(2)),
    pnl:       parseFloat(pnl.toFixed(2)),
    reason,
    ts:        new Date().toISOString(),
  };

  _portfolio.closedTrades.unshift(trade);
  if (_portfolio.closedTrades.length > 200) _portfolio.closedTrades.pop();

  _emitter.emit('trade', trade);
  return trade;
}

// Check stop-loss / take-profit for all open positions at current price
function _checkExits(symbol, price) {
  const pos = _portfolio.openPositions[symbol];
  if (!pos) return;

  if (price <= pos.stopLoss)   { _placeSell(symbol, price, 'STOP_LOSS');   return; }
  if (price >= pos.takeProfit) { _placeSell(symbol, price, 'TAKE_PROFIT'); return; }
}

// ── Tick engine ───────────────────────────────────────────────────────────────

async function _tick() {
  _tickCount++;
  const signals = [];

  for (const symbol of _watchlist) {
    // Init history if first time
    if (!_priceHistory.has(symbol)) {
      _priceHistory.set(symbol, _generateHistory(symbol));
    }

    const history = _priceHistory.get(symbol);
    const regime  = _signalCache.has(symbol) ? _signalCache.get(symbol).regime : 'UNKNOWN';

    // Simulate next price bar
    const lastPrice = history[history.length - 1];
    const newPrice  = _nextPrice(lastPrice, regime);
    history.push(newPrice);
    if (history.length > 500) history.shift(); // rolling window

    // Check exits on existing positions
    _checkExits(symbol, newPrice);

    // Generate signal
    const sig = _generateSignal(symbol, history);
    _signalCache.set(symbol, sig);
    signals.push(sig);

    // Execute paper trade
    if (sig.signal === 'BUY' && sig.confidence >= MIN_CONFIDENCE && !_portfolio.openPositions[symbol]) {
      _placeBuy(symbol, newPrice);
    } else if (sig.signal === 'SELL' && _portfolio.openPositions[symbol]) {
      _placeSell(symbol, newPrice, 'SIGNAL');
    }
  }

  // Update equity curve (sample every 5 ticks to avoid huge array)
  if (_tickCount % 5 === 0) {
    const openPnl = Object.entries(_portfolio.openPositions).reduce((sum, [sym, pos]) => {
      const cur = _priceHistory.get(sym);
      const curPrice = cur ? cur[cur.length - 1] : pos.entryPrice;
      return sum + (curPrice - pos.entryPrice) * pos.qty;
    }, 0);
    const equity = parseFloat((_portfolio.capital + openPnl).toFixed(2));
    _portfolio.equityCurve.push({ t: Date.now(), equity });
    if (_portfolio.equityCurve.length > 500) _portfolio.equityCurve.shift();
  }

  _emitter.emit('tick', signals);
  return signals;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start(opts = {}) {
  if (_running) return;

  if (opts.watchlist) _watchlist = opts.watchlist.map(s => s.toUpperCase());
  const interval = opts.intervalMs || DEFAULT_INTERVAL;
  _running = true;

  // Pre-generate histories for all symbols
  for (const sym of _watchlist) {
    if (!_priceHistory.has(sym)) {
      _priceHistory.set(sym, _generateHistory(sym));
    }
  }

  // Wire tick/trade events → WebSocket broadcast
  try {
    const ldf = require('../data/liveDataFeed');
    _emitter.on('tick', (signals) => {
      try { ldf.broadcastAll({ type: 'SIM_TICK', data: { signals, portfolio: getPortfolioState() }, ts: Date.now() }); } catch(_) {}
    });
    _emitter.on('trade', (trade) => {
      try { ldf.broadcastAll({ type: 'SIM_TRADE', data: trade, ts: Date.now() }); } catch(_) {}
    });
  } catch(_) { /* liveDataFeed unavailable — polling still works */ }

  // Run one tick immediately
  _tick().catch(console.error);
  _timer = setInterval(() => _tick().catch(console.error), interval);

  console.log(`[SimEngine] Started | symbols=${_watchlist.length} | interval=${interval}ms`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running = false;
  console.log('[SimEngine] Stopped');
}

function getLatestSignals(symbols = null) {
  if (symbols) {
    return symbols.map(s => _signalCache.get(s.toUpperCase()) || { symbol: s, signal: null });
  }
  return [..._signalCache.values()];
}

function getPortfolioState() {
  // Calculate live open P&L
  const openPositions = {};
  let openPnl = 0;

  for (const [sym, pos] of Object.entries(_portfolio.openPositions)) {
    const history = _priceHistory.get(sym);
    const curPrice = history ? history[history.length - 1] : pos.entryPrice;
    const unrealizedPnl = parseFloat(((curPrice - pos.entryPrice) * pos.qty).toFixed(2));
    openPnl += unrealizedPnl;
    openPositions[sym] = { ...pos, currentPrice: parseFloat(curPrice.toFixed(2)), unrealizedPnl };
  }

  const equity = parseFloat((_portfolio.capital + openPnl).toFixed(2));
  const totalReturn = parseFloat(((equity - _portfolio.initialCapital) / _portfolio.initialCapital * 100).toFixed(2));

  return {
    capital:        parseFloat(_portfolio.capital.toFixed(2)),
    initialCapital: _portfolio.initialCapital,
    equity,
    openPnl:        parseFloat(openPnl.toFixed(2)),
    totalPnl:       _portfolio.totalPnl,
    totalReturn,
    openPositions,
    openPositionCount: Object.keys(_portfolio.openPositions).length,
  };
}

function getRecentTrades(limit = 30) {
  return _portfolio.closedTrades.slice(0, limit);
}

function getEquityCurve() {
  return _portfolio.equityCurve;
}

function getStatus() {
  return {
    running:    _running,
    tickCount:  _tickCount,
    watchlist:  _watchlist,
    signalCache: _signalCache.size,
    mode:       'SIMULATION',
  };
}

function addSymbol(symbol) {
  const sym = symbol.toUpperCase();
  if (!_watchlist.includes(sym)) {
    _watchlist.push(sym);
    if (!SEED_PRICES[sym]) {
      // Use a random seed price for unknown symbols
      SEED_PRICES[sym] = 500 + Math.floor(Math.random() * 2000);
    }
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

// Expose event emitter for real-time subscriptions
const on  = (event, cb) => _emitter.on(event, cb);
const off = (event, cb) => _emitter.off(event, cb);

module.exports = {
  start, stop,
  getLatestSignals, getPortfolioState,
  getRecentTrades, getEquityCurve, getStatus,
  addSymbol, removeSymbol, getPriceHistory,
  on, off,
  SEED_PRICES,
};
