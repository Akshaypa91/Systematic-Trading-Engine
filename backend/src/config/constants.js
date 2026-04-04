// src/config/constants.js — UPGRADED
'use strict';
require('dotenv').config();

module.exports = Object.freeze({
  PORT:     parseInt(process.env.PORT     || '3000', 10),
  NODE_ENV: process.env.NODE_ENV           || 'development',

  NSE: {
    BASE_URL:          'https://www.nseindia.com',
    API_BASE:          'https://www.nseindia.com/api',
    TIMEOUT_MS:        parseInt(process.env.NSE_REQUEST_TIMEOUT || '15000', 10),
    RETRY_ATTEMPTS:    parseInt(process.env.NSE_RETRY_ATTEMPTS  || '3', 10),
    RETRY_DELAY_MS:    parseInt(process.env.NSE_RETRY_DELAY_MS  || '2000', 10),
    RATE_LIMIT_RPM:    parseInt(process.env.NSE_RATE_LIMIT_PER_MINUTE || '30', 10),
    COOKIE_REFRESH_MS: 20 * 60 * 1000,
    USER_AGENTS: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
  },

  CACHE: {
    DEFAULT_TTL_S: parseInt(process.env.CACHE_TTL_SECONDS     || '300', 10),
    MARKET_TTL_S:  parseInt(process.env.MARKET_DATA_CACHE_TTL || '60',  10),
  },

  RISK: {
    DEFAULT_CAPITAL:         parseFloat(process.env.DEFAULT_CAPITAL         || '1000000'),
    MAX_RISK_PER_TRADE_PCT:  parseFloat(process.env.MAX_RISK_PER_TRADE_PCT  || '0.02'),
    MAX_DAILY_LOSS_PCT:      parseFloat(process.env.MAX_DAILY_LOSS_PCT      || '0.05'),
    DEFAULT_STOP_LOSS_PCT:   parseFloat(process.env.DEFAULT_STOP_LOSS_PCT   || '0.02'),
    DEFAULT_TAKE_PROFIT_PCT: parseFloat(process.env.DEFAULT_TAKE_PROFIT_PCT || '0.04'),
    MAX_OPEN_POSITIONS:      parseInt(process.env.MAX_OPEN_POSITIONS        || '10', 10),
    VOL_TARGET_ANNUAL:       parseFloat(process.env.VOL_TARGET_ANNUAL       || '0.15'),
    VOL_LOOKBACK_DAYS:       parseInt(process.env.VOL_LOOKBACK_DAYS         || '20', 10),
    MAX_PORTFOLIO_EXPOSURE:  parseFloat(process.env.MAX_PORTFOLIO_EXPOSURE  || '0.95'),
    MAX_SINGLE_ASSET_PCT:    parseFloat(process.env.MAX_SINGLE_ASSET_PCT    || '0.20'),
  },

  STRATEGY_WEIGHTS: {
    MEAN_REVERSION: parseFloat(process.env.WEIGHT_MEAN_REVERSION || '0.35'),
    MA_CROSSOVER:   parseFloat(process.env.WEIGHT_MA_CROSSOVER   || '0.35'),
    RSI:            parseFloat(process.env.WEIGHT_RSI            || '0.30'),
  },

  BACKTEST: {
    COMMISSION_PCT:        parseFloat(process.env.BACKTEST_COMMISSION_PCT  || '0.0003'),
    SLIPPAGE_PCT:          parseFloat(process.env.BACKTEST_SLIPPAGE_PCT    || '0.0005'),
    DEFAULT_CAPITAL:       parseFloat(process.env.BACKTEST_DEFAULT_CAPITAL || '1000000'),
    RISK_FREE_RATE:        0.065,
    TRADING_DAYS_PER_YEAR: 252,
  },

  // NEW: Realistic NSE transaction cost breakdown
  TRANSACTION_COSTS: {
    BROKERAGE_PCT:       parseFloat(process.env.BROKERAGE_PCT       || '0.0003'),
    BROKERAGE_FLAT:      parseFloat(process.env.BROKERAGE_FLAT      || '20'),
    STT_SELL_PCT:        parseFloat(process.env.STT_SELL_PCT        || '0.001'),
    STT_BUY_PCT:         parseFloat(process.env.STT_BUY_PCT         || '0'),
    EXCHANGE_CHARGE_PCT: parseFloat(process.env.EXCHANGE_CHARGE_PCT || '0.0000335'),
    SEBI_FEE_PCT:        parseFloat(process.env.SEBI_FEE_PCT        || '0.000001'),
    GST_RATE:            parseFloat(process.env.GST_RATE            || '0.18'),
    STAMP_DUTY_PCT:      parseFloat(process.env.STAMP_DUTY_PCT      || '0.00015'),
    DP_CHARGE_FLAT:      parseFloat(process.env.DP_CHARGE_FLAT      || '13.5'),
    USE_SIMPLIFIED:      process.env.USE_SIMPLIFIED_COSTS !== 'false',
  },

  // NEW: Slippage model
  SLIPPAGE: {
    BASE_PCT:      parseFloat(process.env.SLIPPAGE_BASE_PCT      || '0.0002'),
    SPREAD_PCT:    parseFloat(process.env.SLIPPAGE_SPREAD_PCT    || '0.0003'),
    IMPACT_FACTOR: parseFloat(process.env.SLIPPAGE_IMPACT_FACTOR || '0.1'),
    VOL_SCALING:   process.env.SLIPPAGE_VOL_SCALING !== 'false',
    MAX_PCT:       parseFloat(process.env.SLIPPAGE_MAX_PCT       || '0.005'),
  },

  // NEW: Market regime detection
  REGIME: {
    ADX_PERIOD:        parseInt(process.env.REGIME_ADX_PERIOD        || '14', 10),
    SLOPE_PERIOD:      parseInt(process.env.REGIME_SLOPE_PERIOD      || '20', 10),
    TREND_ADX_MIN:     parseFloat(process.env.REGIME_TREND_ADX_MIN   || '25'),
    SIDEWAYS_ADX_MAX:  parseFloat(process.env.REGIME_SIDEWAYS_ADX_MAX|| '20'),
    VOL_PERCENTILE_HI: parseFloat(process.env.REGIME_VOL_PCT_HI      || '0.75'),
    VOL_PERCENTILE_LO: parseFloat(process.env.REGIME_VOL_PCT_LO      || '0.25'),
    SLOPE_THRESHOLD:   parseFloat(process.env.REGIME_SLOPE_THRESHOLD || '0.001'),
  },

  // NEW: Portfolio engine config
  PORTFOLIO: {
    MAX_ASSETS:      parseInt(process.env.PORTFOLIO_MAX_ASSETS     || '10', 10),
    REBALANCE_FREQ:  parseInt(process.env.PORTFOLIO_REBALANCE_DAYS || '5', 10),
    CORRELATION_MAX: parseFloat(process.env.PORTFOLIO_CORR_MAX     || '0.85'),
    ALLOC_METHOD:    process.env.PORTFOLIO_ALLOC_METHOD            || 'equal',
  },

  // ENHANCED: Walk-forward with strict separation
  WALK_FORWARD: {
    DEFAULT_WINDOWS: parseInt(process.env.WF_WINDOWS      || '3', 10),
    IS_FRACTION:     parseFloat(process.env.WF_IS_FRACTION || '0.70'),
    MIN_OOS_BARS:    parseInt(process.env.WF_MIN_OOS_BARS  || '63', 10),
    MIN_IS_BARS:     parseInt(process.env.WF_MIN_IS_BARS   || '201', 10),
    PURGE_BARS:      parseInt(process.env.WF_PURGE_BARS    || '5', 10),
    EMBARGO_BARS:    parseInt(process.env.WF_EMBARGO_BARS  || '5', 10),
  },

  STRATEGIES: {
    MEAN_REVERSION: { LOOKBACK: 20, Z_BUY_THRESHOLD: -1.5, Z_SELL_THRESHOLD: 1.5, Z_EXIT_THRESHOLD: 0.5 },
    MA_CROSSOVER:   { FAST_PERIOD: 50, SLOW_PERIOD: 200 },
    RSI:            { PERIOD: 14, OVERSOLD: 30, OVERBOUGHT: 70, EXTREME_OS: 20, EXTREME_OB: 80 },
  },

  SCREENER: {
    MOMENTUM_LOOKBACK_DAYS:   20,
    VOLATILITY_LOOKBACK_DAYS: 20,
    MR_LOOKBACK_DAYS:         20,
  },

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
