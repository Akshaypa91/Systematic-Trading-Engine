// src/engine/walkForwardOptimizer.js — UPGRADED
// ─────────────────────────────────────────────────────────────────────────────
// IMPROVEMENT 6: Strict OOS Separation with Purge & Embargo
//
// PROBLEM IT SOLVES
// ──────────────────
// The original WFO had a subtle LEAKAGE bug:
//   - IS window always started at bar 0 (anchored)
//   - OOS window immediately followed IS with no gap
//
// This causes TWO types of contamination:
//
// 1. OVERLAP BIAS: The first IS window covers all earlier data including the
//    period where indicators are "warming up". Optimising on that data finds
//    parameters that fit the warmup regime — not the real signal.
//
// 2. ADJACENT CONTAMINATION: When IS ends at bar T and OOS starts at T+1,
//    any features computed at T+1 that look back may span IS training data.
//    Example: a 20-bar Z-score at OOS bar 1 uses IS bars 20 bars prior.
//
// SOLUTION: Purge + Embargo Gaps
// ───────────────────────────────
//
// PURGE (before OOS):
//   Remove PURGE_BARS bars between the end of IS and the start of OOS.
//   These bars contain features computed partly from IS data.
//
// EMBARGO (after OOS):
//   Skip EMBARGO_BARS bars after OOS ends before the next IS starts.
//   Prevents any temporal relationship between windows contaminating each other.
//
// Visual:
//   |─── IS ───────|PURGE|─── OOS ───|EMBARGO|─── IS' ───────|...
//
// MULTI-WINDOW ROLLING (not anchored):
//   Each IS window rolls forward, not fixed at bar 0.
//   This prevents early-regime bias and tests generalization.
//
// MINIMUM SIZE ENFORCEMENT:
//   MIN_OOS_BARS: 63 (≈3 months) — prevents statistically meaningless OOS
//   MIN_IS_BARS:  201 — enough for all indicators to warm up
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

const WF = C.WALK_FORWARD;

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

/**
 * Run walk-forward optimization with strict IS/OOS separation.
 *
 * WINDOW CONSTRUCTION (rolling, not anchored)
 * ─────────────────────────────────────────────
 * Given totalBars = N, windows = W, isFraction = 0.70:
 *
 *   windowStep = floor((N - MIN_IS_BARS) / W)
 *   For window w:
 *     isStart  = w × windowStep
 *     isEnd    = isStart + isSize
 *     oosStart = isEnd + PURGE_BARS          ← strict separation
 *     oosEnd   = oosStart + oosSize
 *     nextIs   = oosEnd + EMBARGO_BARS       ← embargo after OOS
 */
function runWalkForward(config) {
  const {
    symbol,
    prices,
    strategy      = 'MEAN_REVERSION',
    windows       = WF.DEFAULT_WINDOWS,
    isFraction    = WF.IS_FRACTION,
    metric        = 'sharpe',
    stopLossPct   = 0.02,
    takeProfitPct = 0.04,
    riskPerTrade  = 0.01,
    capital       = 1_000_000,
  } = config;

  if (!PARAM_GRIDS[strategy])
    throw new Error(`No parameter grid for strategy: ${strategy}`);

  const grid       = PARAM_GRIDS[strategy];
  const totalBars  = prices.length;
  const PURGE      = WF.PURGE_BARS;
  const EMBARGO    = WF.EMBARGO_BARS;
  const MIN_IS     = WF.MIN_IS_BARS;
  const MIN_OOS    = WF.MIN_OOS_BARS;

  // Compute window sizes
  // Available bars after accounting for purge/embargo between windows
  const isSize    = Math.max(MIN_IS, Math.floor(totalBars * isFraction));
  const oosSize   = Math.max(MIN_OOS, Math.floor((totalBars * (1 - isFraction) - (PURGE + EMBARGO) * windows) / windows));
  const windowStep = isSize + PURGE + oosSize + EMBARGO;

  if (windowStep * windows > totalBars) {
    const maxWindows = Math.floor(totalBars / windowStep);
    logger.warn(
      `[WFO] Reducing windows from ${windows} to ${maxWindows} (insufficient bars: ` +
      `${totalBars} < ${windowStep * windows})`
    );
  }

  logger.info(
    `[WFO] ${symbol} | strategy=${strategy} | bars=${totalBars} | ` +
    `IS=${isSize} OOS=${oosSize} purge=${PURGE} embargo=${EMBARGO} | ` +
    `windows=${windows} (rolling, not anchored)`
  );

  const windowResults  = [];
  const allOosTrades   = [];
  let   allOosEquity   = [capital];
  let   runningCapital = capital;
  let   windowStart    = 0;

  for (let w = 0; w < windows; w++) {
    const isStart  = windowStart;
    const isEnd    = isStart + isSize;

    // Enforce minimum IS
    if (isEnd + PURGE + MIN_OOS > totalBars) {
      logger.warn(`[WFO] Window ${w + 1} skipped: insufficient bars remaining`);
      break;
    }

    const oosStart = isEnd + PURGE;       // ← PURGE gap
    const oosEnd   = Math.min(oosStart + oosSize, totalBars);

    if (oosEnd - oosStart < MIN_OOS) {
      logger.warn(`[WFO] Window ${w + 1} skipped: OOS too small (${oosEnd - oosStart} < ${MIN_OOS})`);
      break;
    }

    const isPrices  = prices.slice(isStart, isEnd);
    const oosPrices = prices.slice(oosStart, oosEnd);

    logger.info(
      `[WFO] Window ${w + 1}: IS [${isStart}→${isEnd - 1}] (${isPrices.length} bars) | ` +
      `PURGE [${isEnd}→${oosStart - 1}] | ` +
      `OOS [${oosStart}→${oosEnd - 1}] (${oosPrices.length} bars)`
    );

    // ── In-sample: grid search ─────────────────────────────────────────────
    let bestParams = null;
    let bestScore  = -Infinity;
    const isResults = [];

    for (const params of grid) {
      const result = runSingleBacktest({
        prices: isPrices, strategy, params,
        stopLossPct, takeProfitPct, riskPerTrade, capital,
      });
      const score = getMetricValue(result, metric);
      isResults.push({ params, score, result });
      if (score !== null && isFinite(score) && score > bestScore) {
        bestScore  = score;
        bestParams = params;
      }
    }

    if (!bestParams) {
      logger.warn(`[WFO] Window ${w + 1}: no valid IS params — grid: ${JSON.stringify(grid[0])}`);
      windowStart += windowStep;
      continue;
    }

    // ── Out-of-sample: apply best IS params — NO re-optimisation here ──────
    const oosResult = runSingleBacktest({
      prices: oosPrices, strategy, params: bestParams,
      stopLossPct, takeProfitPct, riskPerTrade, capital: runningCapital,
    });

    runningCapital = oosResult.finalCapital;
    allOosEquity   = allOosEquity.concat(oosResult.equityCurve.slice(1));
    allOosTrades.push(...(oosResult.trades || []));

    // Compute IS overfitting ratio (IS score vs OOS score)
    const oosScore = getMetricValue(oosResult, metric);
    const overfitRatio = (bestScore > 0 && oosScore !== null)
      ? parseFloat((oosScore / bestScore).toFixed(4))
      : null;

    windowResults.push({
      window:    w + 1,
      isPeriod: {
        start: prices[isStart]?.date, end: prices[isEnd - 1]?.date,
        bars: isPrices.length,
      },
      oosPeriod: {
        start: prices[oosStart]?.date, end: prices[oosEnd - 1]?.date,
        bars: oosPrices.length,
      },
      purgeGap:  PURGE,
      bestParams,
      isScore:   parseFloat((bestScore || 0).toFixed(4)),
      overfitRatio,  // NEW: <0.5 suggests overfitting in IS
      oos: {
        totalReturn:  parseFloat(oosResult.totalReturnPct.toFixed(3)),
        sharpe:       oosResult.sharpeRatio,
        maxDrawdown:  parseFloat(oosResult.maxDrawdownPct.toFixed(3)),
        winRate:      parseFloat(oosResult.winRatePct.toFixed(2)),
        trades:       oosResult.totalTrades,
      },
    });

    logger.info(
      `[WFO] Window ${w + 1} done: params=${JSON.stringify(bestParams)} | ` +
      `IS ${metric}=${bestScore.toFixed(3)} | OOS return=${oosResult.totalReturnPct.toFixed(2)}% | ` +
      `overfitRatio=${overfitRatio ?? 'N/A'}`
    );

    // Advance window by step (rolling, not anchored)
    windowStart += isSize + PURGE + oosPrices.length + EMBARGO;
  }

  // ── Aggregate OOS metrics ─────────────────────────────────────────────────
  const { maxDrawdown } = mu.maxDrawdown(allOosEquity);
  const totalOosReturn  = ((runningCapital - capital) / capital) * 100;
  const avgIsScore      = windowResults.length ? mu.mean(windowResults.map(w => w.isScore)) : 0;
  const avgOosReturn    = windowResults.length ? mu.mean(windowResults.map(w => w.oos.totalReturn)) : 0;
  const avgOverfit      = windowResults.filter(w => w.overfitRatio != null).map(w => w.overfitRatio);

  const paramStrings    = windowResults.map(w => JSON.stringify(w.bestParams)).filter(Boolean);
  const bestParamsFreq  = paramStrings.length > 0 ? mostCommon(paramStrings) : null;

  // Stability score: how consistent are OOS returns across windows?
  const oosReturns  = windowResults.map(w => w.oos.totalReturn);
  const oosStdDev   = oosReturns.length >= 2 ? mu.stdDev(oosReturns) : null;
  const stability   = oosStdDev != null && avgOosReturn !== 0
    ? parseFloat((avgOosReturn / oosStdDev).toFixed(4))  // OOS info ratio
    : null;

  return {
    symbol,
    strategy,
    optimisationMetric: metric,
    totalWindows:   windowResults.length,
    windows:        windowResults,
    // NEW: OOS separation quality metrics
    separationConfig: { purgeGap: PURGE, embargoGap: EMBARGO, rollingWindows: true },
    aggregateOos: {
      totalReturnPct:    parseFloat(totalOosReturn.toFixed(3)),
      maxDrawdownPct:    parseFloat((maxDrawdown * 100).toFixed(3)),
      initialCapital:    capital,
      finalCapital:      parseFloat(runningCapital.toFixed(2)),
      totalTrades:       allOosTrades.length,
      efficiencyRatio:   avgIsScore > 0 ? parseFloat((avgOosReturn / avgIsScore).toFixed(4)) : null,
      avgOverfitRatio:   avgOverfit.length ? parseFloat((mu.mean(avgOverfit)).toFixed(4)) : null,
      oosStabilityScore: stability,   // NEW: IR of OOS returns — higher = more stable
    },
    recommendedParams: bestParamsFreq ? JSON.parse(bestParamsFreq) : null,
    equityCurve: downsample(allOosEquity),
  };
}

// ── Single backtest (lightweight, for grid search) ────────────────────────────

function runSingleBacktest({ prices, strategy, params, stopLossPct, takeProfitPct, riskPerTrade, capital }) {
  const minBars = strategy === 'MA_CROSSOVER'
    ? (params.slow || 200) + 1
    : strategy === 'RSI'
      ? (params.period || 14) + 1
      : (params.lookback || 20) + 1;

  if (prices.length < minBars)
    return { totalReturnPct: 0, sharpeRatio: null, maxDrawdownPct: 0,
             winRatePct: 0, totalTrades: 0, finalCapital: capital, equityCurve: [capital], trades: [] };

  const closes      = prices.map(p => p.close || p);
  let   curCapital  = capital;
  let   position    = null;
  const trades      = [];
  const equityCurve = [capital];
  const dailyRets   = [];

  for (let i = minBars - 1; i < closes.length; i++) {
    const bar   = prices[i];
    const close = closes[i];

    if (position) {
      const ex = checkExit(bar, position);
      if (!ex.hold) {
        const pnl   = (ex.price - position.entry) * position.qty;
        curCapital += ex.price * position.qty;
        trades.push({ pnl, pnlPct: (pnl / (position.entry * position.qty)) * 100, exitReason: ex.reason });
        position = null;
      }
    }

    if (!position) {
      const sig = getStrategySignal(closes.slice(0, i + 1), strategy, params);
      if (sig === 'BUY') {
        const riskPer = close * stopLossPct;
        const qty     = riskPer > 0 ? Math.floor((curCapital * riskPerTrade) / riskPer) : 0;
        if (qty > 0 && qty * close <= curCapital) {
          curCapital -= qty * close;
          position    = { qty, entry: close,
            stopLoss:   close * (1 - stopLossPct),
            takeProfit: close * (1 + takeProfitPct) };
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

  if (position) {
    const last = closes[closes.length - 1];
    curCapital += last * position.qty;
    const pnl   = (last - position.entry) * position.qty;
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

function checkExit(bar, position) {
  const low  = isFinite(bar.low)  ? bar.low  : bar.close;
  const high = isFinite(bar.high) ? bar.high : bar.close;
  if (low  <= position.stopLoss)   return { hold: false, price: position.stopLoss,   reason: 'STOP_LOSS' };
  if (high >= position.takeProfit) return { hold: false, price: position.takeProfit, reason: 'TAKE_PROFIT' };
  return { hold: true };
}

function getStrategySignal(closes, strategy, params) {
  const need = strategy === 'MA_CROSSOVER' ? (params.slow || 200) + 1
             : strategy === 'RSI'          ? (params.period || 14) + 1
             :                               (params.lookback || 20) + 1;
  if (closes.length < need) return 'HOLD';

  if (strategy === 'MEAN_REVERSION') {
    const lb  = params.lookback || 20;
    const win = closes.slice(-lb);
    const m   = mu.mean(win);
    const s   = mu.stdDev(win);
    if (s === 0) return 'HOLD';
    const z = (closes[closes.length - 1] - m) / s;
    if (z < (params.zBuy  || -2)) return 'BUY';
    if (z > (params.zSell ||  2)) return 'SELL';
    return 'HOLD';
  }
  if (strategy === 'RSI') {
    const r = mu.rsi(closes, params.period || 14);
    if (r === null) return 'HOLD';
    if (r < (params.oversold   || 30)) return 'BUY';
    if (r > (params.overbought || 70)) return 'SELL';
    return 'HOLD';
  }
  if (strategy === 'MA_CROSSOVER') {
    const maF = mu.sma(closes, params.fast || 50);
    const maS = mu.sma(closes, params.slow || 200);
    if (!maF || !maS) return 'HOLD';
    return maF > maS ? 'BUY' : 'SELL';
  }
  return 'HOLD';
}

function getMetricValue(result, metric) {
  switch (metric) {
    case 'sharpe':      return result.sharpeRatio;
    case 'totalReturn': return result.totalReturnPct;
    case 'calmar':      return result.maxDrawdownPct > 0 ? result.totalReturnPct / result.maxDrawdownPct : null;
    case 'sortino':     return result.sortinoRatio ?? result.sharpeRatio;
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

function downsample(arr, step = 5) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  return arr.filter((_, i) => i % step === 0).map(v => parseFloat(v.toFixed(2)));
}

module.exports = { runWalkForward, PARAM_GRIDS };
