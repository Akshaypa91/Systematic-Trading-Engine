// src/engine/walkForwardOptimizer.js
// ─────────────────────────────────────────────────────────────────────────────
// Walk-Forward Optimization
//
// METHODOLOGY
// ───────────
// Walk-forward testing is the gold standard for avoiding overfitting in
// systematic trading. It works as follows:
//
//   1. Split data into N windows
//   2. For each window:
//      a. In-sample (IS) period: grid-search all parameter combinations,
//         pick the best by chosen metric (default: Sharpe ratio)
//      b. Out-of-sample (OOS) period: apply best IS parameters, record results
//   3. Concatenate OOS results → this is your unbiased performance estimate
//
// Window structure (default: 70% IS / 30% OOS):
//   |─── IS 70% ───|─ OOS 30% ─|
//                   |─── IS 70% ───|─ OOS 30% ─|
//                                   ...
//
// This prevents "fit the future" bias — parameters are never optimised on the
// data they are tested on.
//
// PARAMETER GRID
// ──────────────
// Each strategy exposes a parameter grid. We exhaustively test every
// combination (brute-force grid search). For production, replace with
// Bayesian optimization (e.g., Gaussian Process) to reduce search time.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const logger = require('../config/logger');

// ─── Parameter grids ─────────────────────────────────────────────────────────

const PARAM_GRIDS = {
  MEAN_REVERSION: [
    { lookback: 10, zBuy: -1.5, zSell: 1.5 },
    { lookback: 15, zBuy: -1.5, zSell: 1.5 },
    { lookback: 20, zBuy: -2.0, zSell: 2.0 },
    { lookback: 20, zBuy: -1.5, zSell: 1.5 },
    { lookback: 25, zBuy: -2.0, zSell: 2.0 },
    { lookback: 30, zBuy: -2.0, zSell: 2.0 },
    { lookback: 30, zBuy: -2.5, zSell: 2.5 },
  ],
  RSI: [
    { period: 9,  oversold: 25, overbought: 75 },
    { period: 9,  oversold: 30, overbought: 70 },
    { period: 14, oversold: 30, overbought: 70 },
    { period: 14, oversold: 25, overbought: 75 },
    { period: 14, oversold: 20, overbought: 80 },
    { period: 21, oversold: 30, overbought: 70 },
    { period: 21, oversold: 25, overbought: 75 },
  ],
  MA_CROSSOVER: [
    { fast:  20, slow: 100 },
    { fast:  20, slow: 150 },
    { fast:  50, slow: 150 },
    { fast:  50, slow: 200 },
    { fast: 100, slow: 200 },
  ],
};

// ─── Core walk-forward function ───────────────────────────────────────────────

/**
 * Run walk-forward optimization for a single strategy.
 *
 * @param {{
 *   symbol:       string,
 *   prices:       Array<{ date: string, close: number, high: number, low: number }>,
 *   strategy:     'MEAN_REVERSION' | 'RSI' | 'MA_CROSSOVER',
 *   windows:      number,       // Number of WF windows (default 3)
 *   isFraction:   number,       // In-sample fraction (default 0.7)
 *   metric:       'sharpe' | 'totalReturn' | 'calmar',
 *   stopLossPct:  number,
 *   takeProfitPct:number,
 *   riskPerTrade: number,
 *   capital:      number,
 * }} config
 * @returns {{ windows: Array, oosResults: Object, bestParams: Object }}
 */
function runWalkForward(config) {
  const {
    symbol,
    prices,
    strategy      = 'MEAN_REVERSION',
    windows       = 3,
    isFraction    = 0.70,
    metric        = 'sharpe',
    stopLossPct   = 0.02,
    takeProfitPct = 0.04,
    riskPerTrade  = 0.01,
    capital       = 1_000_000,
  } = config;

  if (!PARAM_GRIDS[strategy]) {
    throw new Error(`No parameter grid for strategy: ${strategy}`);
  }

  const grid = PARAM_GRIDS[strategy];
  const windowResults = [];
  const allOosTrades  = [];
  let   allOosEquity  = [capital];
  let   runningCapital = capital;

  const totalBars = prices.length;
  // Anchored walk-forward: each window starts oosSize bars after the previous.
  // IS period is fixed at isFraction of total bars (minimum 210 bars).
  // OOS period is the remaining slice per window.
  const minIsBars  = 210;
  const isSize     = Math.max(minIsBars, Math.floor(totalBars * isFraction));
  const oosSize    = Math.max(50, Math.floor((totalBars - isSize) / windows));
  const windowSize = isSize + oosSize; // informational only — used in log

  logger.info(`[WFO] ${symbol} | strategy=${strategy} | windows=${windows} | bars=${totalBars} | windowSize=${windowSize}`);

  for (let w = 0; w < windows; w++) {
    const startIdx = 0;                              // IS always starts at bar 0
    const splitIdx = isSize;                         // IS ends here
    const oosStart = isSize + w * oosSize;           // OOS slides forward
    const endIdx   = Math.min(oosStart + oosSize, totalBars);
    // Redefine isPrices / oosPrices using correct anchored slices
    const isPricesW  = prices.slice(startIdx, splitIdx);
    const oosPricesW = prices.slice(oosStart, endIdx);

    if (oosPricesW.length < 50 || isPricesW.length < 201 || oosStart >= totalBars) {
      logger.warn(`[WFO] Window ${w + 1} skipped: insufficient bars`);
      continue;
    }

    const isPrices  = isPricesW;
    const oosPrices = oosPricesW;

    // ── In-sample: grid search ──────────────────────────────────────────
    let bestParams = null;
    let bestScore  = -Infinity;
    const isResults = [];

    for (const params of grid) {
      const result = runSingleBacktest({
        prices:     isPrices,
        strategy,
        params,
        stopLossPct,
        takeProfitPct,
        riskPerTrade,
        capital,
      });
      const score = getMetricValue(result, metric);
      isResults.push({ params, score, result });

      if (score !== null && score > bestScore) {
        bestScore  = score;
        bestParams = params;
      }
    }

    if (!bestParams) {
      logger.warn(`[WFO] Window ${w + 1}: no valid IS params found`);
      continue;
    }

    // ── Out-of-sample: apply best IS params ────────────────────────────
    const oosResult = runSingleBacktest({
      prices:     oosPrices,
      strategy,
      params:     bestParams,
      stopLossPct,
      takeProfitPct,
      riskPerTrade,
      capital: runningCapital,
    });

    runningCapital = oosResult.finalCapital;

    // Accumulate OOS equity curve (chain windows)
    allOosEquity = allOosEquity.concat(oosResult.equityCurve.slice(1));
    allOosTrades.push(...(oosResult.trades || []));

    windowResults.push({
      window:    w + 1,
      isPeriod:  { start: prices[startIdx]?.date, end: prices[splitIdx - 1]?.date, bars: isPrices.length },
      oosPeriod: { start: prices[splitIdx]?.date,  end: prices[endIdx - 1]?.date,  bars: oosPrices.length },
      bestParams,
      isScore:   parseFloat((bestScore || 0).toFixed(4)),
      oos: {
        totalReturn:  parseFloat(oosResult.totalReturnPct.toFixed(3)),
        sharpe:       oosResult.sharpeRatio,
        maxDrawdown:  parseFloat(oosResult.maxDrawdownPct.toFixed(3)),
        winRate:      parseFloat(oosResult.winRatePct.toFixed(2)),
        trades:       oosResult.totalTrades,
      },
    });

    logger.info(
      `[WFO] Window ${w + 1}: bestParams=${JSON.stringify(bestParams)} | ` +
      `IS ${metric}=${bestScore.toFixed(3)} | OOS return=${oosResult.totalReturnPct.toFixed(2)}%`
    );
  }

  // ── Aggregate OOS metrics ────────────────────────────────────────────
  const { maxDrawdown } = mu.maxDrawdown(allOosEquity);
  const totalOosReturn  = ((runningCapital - capital) / capital) * 100;

  // Efficiency ratio: OOS metric / IS metric (>0.5 = good)
  const avgIsScore = windowResults.length
    ? mu.mean(windowResults.map(w => w.isScore))
    : 0;
  const avgOosReturn = windowResults.length
    ? mu.mean(windowResults.map(w => w.oos.totalReturn))
    : 0;

  // Most frequently selected params (null-safe when all windows were skipped)
  const paramStrings   = windowResults.map(w => JSON.stringify(w.bestParams)).filter(Boolean);
  const bestParamsFreq = paramStrings.length > 0 ? mostCommon(paramStrings) : null;

  return {
    symbol,
    strategy,
    optimisationMetric: metric,
    totalWindows:   windowResults.length,
    windows:        windowResults,
    aggregateOos: {
      totalReturnPct:   parseFloat(totalOosReturn.toFixed(3)),
      maxDrawdownPct:   parseFloat((maxDrawdown * 100).toFixed(3)),
      initialCapital:   capital,
      finalCapital:     parseFloat(runningCapital.toFixed(2)),
      totalTrades:      allOosTrades.length,
      efficiencyRatio:  avgIsScore > 0 ? parseFloat((avgOosReturn / avgIsScore).toFixed(4)) : null,
    },
    recommendedParams: bestParamsFreq ? JSON.parse(bestParamsFreq) : null,
    equityCurve: downsample(allOosEquity, 200),
  };
}

// ─── Single backtest for optimizer ────────────────────────────────────────────
// Lightweight inline backtester (avoids circular dep with main backtester)

function runSingleBacktest({ prices, strategy, params, stopLossPct, takeProfitPct, riskPerTrade, capital }) {
  if (prices.length < 202) {
    return { totalReturnPct: 0, sharpeRatio: null, maxDrawdownPct: 0, winRatePct: 0, totalTrades: 0, finalCapital: capital, equityCurve: [capital], trades: [] };
  }

  const closes      = prices.map(p => p.close || p);
  let   curCapital  = capital;
  let   position    = null;
  const trades      = [];
  const equityCurve = [capital];
  const dailyRets   = [];

  for (let i = 201; i < closes.length; i++) {
    const window = closes.slice(0, i + 1);
    const bar    = prices[i];
    const close  = closes[i];

    // ── Exit check ───────────────────────────────────────────────────
    if (position) {
      const exitResult = checkPositionExit(bar, position);
      if (!exitResult.hold) {
        const pnl       = (exitResult.price - position.entry) * position.qty;
        curCapital     += exitResult.price * position.qty;
        trades.push({ pnl, pnlPct: (pnl / (position.entry * position.qty)) * 100, exitReason: exitResult.reason });
        position = null;
      }
    }

    // ── Signal ──────────────────────────────────────────────────────
    if (!position) {
      const sig = getStrategySignal(window, strategy, params);
      if (sig === 'BUY') {
        const riskAmt  = curCapital * riskPerTrade;
        const riskPer  = close * stopLossPct;
        const qty      = riskPer > 0 ? Math.floor(riskAmt / riskPer) : 0;
        if (qty > 0 && qty * close <= curCapital) {
          curCapital -= qty * close;
          position    = {
            qty, entry: close,
            stopLoss:   close * (1 - stopLossPct),
            takeProfit: close * (1 + takeProfitPct),
          };
        }
      }
    }

    const equity = curCapital + (position ? close * position.qty : 0);
    equityCurve.push(equity);
    if (equityCurve.length >= 2) {
      const prev = equityCurve[equityCurve.length - 2];
      dailyRets.push(prev > 0 ? (equity - prev) / prev : 0);
    }
  }

  // Close open position at end
  if (position) {
    const lastClose = closes[closes.length - 1];
    const pnl       = (lastClose - position.entry) * position.qty;
    curCapital     += lastClose * position.qty;
    trades.push({ pnl, pnlPct: (pnl / (position.entry * position.qty)) * 100, exitReason: 'END' });
  }

  const wins = trades.filter(t => t.pnl > 0);
  const { maxDrawdown } = mu.maxDrawdown(equityCurve);
  const sharpe = mu.sharpeRatio(dailyRets, 0.065, 252);

  return {
    totalReturnPct:  ((curCapital - capital) / capital) * 100,
    sharpeRatio:     sharpe,
    maxDrawdownPct:  maxDrawdown * 100,
    winRatePct:      trades.length ? (wins.length / trades.length) * 100 : 0,
    totalTrades:     trades.length,
    finalCapital:    curCapital,
    equityCurve,
    trades,
  };
}

function checkPositionExit(bar, position) {
  const low  = bar.low  || bar.close;
  const high = bar.high || bar.close;
  if (low  <= position.stopLoss)   return { hold: false, price: position.stopLoss,   reason: 'STOP_LOSS' };
  if (high >= position.takeProfit) return { hold: false, price: position.takeProfit, reason: 'TAKE_PROFIT' };
  return { hold: true };
}

function getStrategySignal(closes, strategy, params) {
  if (closes.length < 202) return 'HOLD';

  if (strategy === 'MEAN_REVERSION') {
    const lb     = params.lookback || 20;
    const window = closes.slice(-lb);
    const mean   = mu.mean(window);
    const std    = mu.stdDev(window);
    if (std === 0) return 'HOLD';
    const z = (closes[closes.length - 1] - mean) / std;
    if (z < (params.zBuy  || -2)) return 'BUY';
    if (z > (params.zSell || 2))  return 'SELL';
    return 'HOLD';
  }

  if (strategy === 'RSI') {
    const r = mu.rsi(closes, params.period || 14);
    if (r === null)              return 'HOLD';
    if (r < (params.oversold  || 30)) return 'BUY';
    if (r > (params.overbought|| 70)) return 'SELL';
    return 'HOLD';
  }

  if (strategy === 'MA_CROSSOVER') {
    const fast = params.fast || 50;
    const slow = params.slow || 200;
    if (closes.length < slow + 1) return 'HOLD';
    const maF = mu.sma(closes, fast);
    const maS = mu.sma(closes, slow);
    if (!maF || !maS) return 'HOLD';
    return maF > maS ? 'BUY' : 'SELL';
  }

  return 'HOLD';
}

function getMetricValue(result, metric) {
  switch (metric) {
    case 'sharpe':      return result.sharpeRatio;
    case 'totalReturn': return result.totalReturnPct;
    case 'calmar':
      return result.maxDrawdownPct > 0
        ? result.totalReturnPct / result.maxDrawdownPct
        : null;
    default:            return result.sharpeRatio;
  }
}

function mostCommon(arr) {
  const freq = {};
  let maxK = arr[0], maxV = 0;
  for (const item of arr) {
    freq[item] = (freq[item] || 0) + 1;
    if (freq[item] > maxV) { maxV = freq[item]; maxK = item; }
  }
  return maxK;
}

function downsample(arr, n) {
  if (arr.length <= n) return arr.map(v => parseFloat(v.toFixed(2)));
  const step = Math.floor(arr.length / n);
  const out  = [];
  for (let i = 0; i < arr.length; i += step) out.push(parseFloat(arr[i].toFixed(2)));
  return out;
}

module.exports = { runWalkForward, PARAM_GRIDS };
