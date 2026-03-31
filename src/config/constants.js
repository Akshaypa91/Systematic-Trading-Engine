// src/config/constants.js
// All business constants in one place — never hardcode these in logic modules

'use strict';

require('dotenv').config();

module.exports = Object.freeze({

  // ─── Server ───────────────────────────────────────────────────────────────
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  // ─── NSE / Market ─────────────────────────────────────────────────────────
  NSE: {
    BASE_URL:          'https://www.nseindia.com',
    API_BASE:          'https://www.nseindia.com/api',
    TIMEOUT_MS:        parseInt(process.env.NSE_REQUEST_TIMEOUT || '15000', 10),
    RETRY_ATTEMPTS:    parseInt(process.env.NSE_RETRY_ATTEMPTS  || '3', 10),
    RETRY_DELAY_MS:    parseInt(process.env.NSE_RETRY_DELAY_MS  || '2000', 10),
    RATE_LIMIT_RPM:    parseInt(process.env.NSE_RATE_LIMIT_PER_MINUTE || '30', 10),
    COOKIE_REFRESH_MS: 20 * 60 * 1000,   // Refresh NSE session cookie every 20 min
    USER_AGENTS: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
  },

  // ─── Cache ────────────────────────────────────────────────────────────────
  CACHE: {
    DEFAULT_TTL_S: parseInt(process.env.CACHE_TTL_SECONDS      || '300', 10),
    MARKET_TTL_S:  parseInt(process.env.MARKET_DATA_CACHE_TTL  || '60',  10),
  },

  // ─── Risk Management ──────────────────────────────────────────────────────
  RISK: {
    DEFAULT_CAPITAL:       parseFloat(process.env.DEFAULT_CAPITAL          || '1000000'),
    MAX_RISK_PER_TRADE_PCT:parseFloat(process.env.MAX_RISK_PER_TRADE_PCT   || '0.02'),   // 2 %
    MAX_DAILY_LOSS_PCT:    parseFloat(process.env.MAX_DAILY_LOSS_PCT       || '0.05'),   // 5 %
    DEFAULT_STOP_LOSS_PCT: parseFloat(process.env.DEFAULT_STOP_LOSS_PCT    || '0.02'),   // 2 %
    DEFAULT_TAKE_PROFIT_PCT:parseFloat(process.env.DEFAULT_TAKE_PROFIT_PCT || '0.04'),   // 4 %
    MAX_OPEN_POSITIONS:    parseInt(process.env.MAX_OPEN_POSITIONS         || '10', 10),
  },

  // ─── Strategy weights (must sum to 1) ─────────────────────────────────────
  STRATEGY_WEIGHTS: {
    MEAN_REVERSION: parseFloat(process.env.WEIGHT_MEAN_REVERSION || '0.35'),
    MA_CROSSOVER:   parseFloat(process.env.WEIGHT_MA_CROSSOVER   || '0.35'),
    RSI:            parseFloat(process.env.WEIGHT_RSI            || '0.30'),
  },

  // ─── Backtesting ──────────────────────────────────────────────────────────
  BACKTEST: {
    COMMISSION_PCT: parseFloat(process.env.BACKTEST_COMMISSION_PCT || '0.0003'),
    SLIPPAGE_PCT:   parseFloat(process.env.BACKTEST_SLIPPAGE_PCT   || '0.0005'),
    DEFAULT_CAPITAL:parseFloat(process.env.BACKTEST_DEFAULT_CAPITAL|| '1000000'),
    RISK_FREE_RATE: 0.065,   // 6.5 % annualised — approx Indian 10-yr G-sec yield
    TRADING_DAYS_PER_YEAR: 252,
  },

  // ─── Strategy Parameters ──────────────────────────────────────────────────
  STRATEGIES: {
    MEAN_REVERSION: {
      LOOKBACK:       20,          // Z-score rolling window
      Z_BUY_THRESHOLD:  -2.0,     // Enter long when z-score < -2
      Z_SELL_THRESHOLD:  2.0,     // Enter short when z-score > +2
      Z_EXIT_THRESHOLD:  0.5,     // Exit when z-score reverts near mean
    },
    MA_CROSSOVER: {
      FAST_PERIOD:  50,
      SLOW_PERIOD:  200,
    },
    RSI: {
      PERIOD:        14,
      OVERSOLD:      30,
      OVERBOUGHT:    70,
      EXTREME_OS:    20,           // Strong buy signal
      EXTREME_OB:    80,           // Strong sell signal
    },
  },

  // ─── Screener ─────────────────────────────────────────────────────────────
  SCREENER: {
    MOMENTUM_LOOKBACK_DAYS:    20,
    VOLATILITY_LOOKBACK_DAYS:  20,
    MR_LOOKBACK_DAYS:          20,
  },

  // ─── Nifty 50 Symbols ─────────────────────────────────────────────────────
  NIFTY50_SYMBOLS: [
    'ADANIENT','ADANIPORTS','APOLLOHOSP','ASIANPAINT','AXISBANK',
    'BAJAJ-AUTO','BAJFINANCE','BAJAJFINSV','BPCL','BHARTIARTL',
    'BRITANNIA','CIPLA','COALINDIA','DIVISLAB','DRREDDY',
    'EICHERMOT','GRASIM','HCLTECH','HDFCBANK','HDFCLIFE',
    'HEROMOTOCO','HINDALCO','HINDUNILVR','ICICIBANK','ITC',
    'INDUSINDBK','INFY','JSWSTEEL','KOTAKBANK','LTIM',
    'LT','M&M','MARUTI','NESTLEIND','NTPC',
    'ONGC','POWERGRID','RELIANCE','SBILIFE','SBIN',
    'SUNPHARMA','TCS','TATACONSUM','TATAMOTORS','TATASTEEL',
    'TECHM','TITAN','ULTRACEMCO','UPL','WIPRO',
  ],
});
