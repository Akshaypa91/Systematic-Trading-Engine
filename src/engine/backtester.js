// src/engine/backtester.js
// ─────────────────────────────────────────────────────────────────────────────
// Backtesting Engine
//
// SIMULATION MODEL
// ────────────────
// • Walk forward through price bars chronologically (no lookahead)
// • At each bar: check open position exits first, then evaluate entry signals
// • Commission model: total_cost = price × qty × (commission + slippage)
// • Entry price = bar close × (1 + slippage)   [conservative fill]
// • Exit  price = bar close × (1 - slippage)   [conservative fill]
//
// METRICS COMPUTED
// ────────────────
// • Total return (%)
// • Annualised return (CAGR)
// • Sharpe ratio (annualised, using daily log returns)
// • Maximum drawdown (%)
// • Win rate (% of trades that were profitable)
// • Profit factor (gross profit / gross loss)
// • Average profit and loss per trade (%)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const aggregator = require('../strategies/aggregator');
const mu         = require('../utils/mathUtils');
const C          = require('../config/constants');
const logger     = require('../config/logger');

const BT = C.BACKTEST;
const R  = C.RISK;

/**
 * Run a backtest for a single symbol.
 *
 * @param {{
 *   symbol:         string,
 *   prices:         Array<{ date: string, open: number, high: number, low: number, close: number, volume?: number }>,
 *   initialCapital: number,
 *   commissionPct:  number,    // e.g. 0.0003
 *   slippagePct:    number,    // e.g. 0.0005
 *   stopLossPct:    number,
 *   takeProfitPct:  number,
 *   riskPerTrade:   number,    // fraction of capital
 *   strategy:       'AGGREGATED' | 'MEAN_REVERSION' | 'MA_CROSSOVER' | 'RSI',
 *   aggrMethod:     'weighted' | 'majority',
 * }} config
 *
 * @returns {{ summary: Object, trades: Array, equityCurve: number[] }}
 */
function runBacktest(config) {
  const {
    symbol,
    prices,
    initialCapital = BT.DEFAULT_CAPITAL,
    commissionPct  = BT.COMMISSION_PCT,
    slippagePct    = BT.SLIPPAGE_PCT,
    stopLossPct    = R.DEFAULT_STOP_LOSS_PCT,
    takeProfitPct  = R.DEFAULT_TAKE_PROFIT_PCT,
    riskPerTrade   = R.MAX_RISK_PER_TRADE_PCT,
    strategy       = 'AGGREGATED',
    aggrMethod     = 'weighted',
  } = config;

  if (!prices || prices.length < 201) {
    throw new Error(`Backtest requires at least 201 price bars, got ${prices?.length ?? 0}`);
  }

  logger.info(`[Backtest] Starting: ${symbol} | strategy=${strategy} | bars=${prices.length} | capital=₹${initialCapital}`);

  let capital   = initialCapital;
  let position  = null;   // { qty, entryPrice, entryDate, stopLoss, takeProfit }
  const trades  = [];
  const equityCurve = [capital];
  const dailyReturns = [];

  // ── Walk-forward loop ────────────────────────────────────────────────────
  for (let i = 200; i < prices.length; i++) {
    const bar      = prices[i];
    const closeSeries = prices.slice(0, i + 1).map(p => p.close);

    // ── Step 1: Check open position exits ───────────────────────────────
    if (position) {
      const exitResult = checkExit(bar, position, closeSeries, strategy, aggrMethod);

      if (exitResult.exit) {
        const fillPrice   = exitResult.exitPrice * (1 - slippagePct);
        const commission  = position.qty * fillPrice * commissionPct;
        const proceeds    = position.qty * fillPrice - commission;
        const cost        = position.qty * position.entryPrice;
        const pnl         = proceeds - cost;
        const pnlPct      = (pnl / cost) * 100;

        capital += proceeds;
        trades.push({
          symbol,
          side:       'BUY',
          entryDate:  position.entryDate,
          entryPrice: position.entryPrice,
          exitDate:   bar.date,
          exitPrice:  parseFloat(fillPrice.toFixed(4)),
          quantity:   position.qty,
          pnl:        parseFloat(pnl.toFixed(2)),
          pnlPct:     parseFloat(pnlPct.toFixed(4)),
          commission: parseFloat(commission.toFixed(2)),
          exitReason: exitResult.reason,
        });

        logger.debug(`[Backtest] EXIT ${exitResult.reason}: ${bar.date} @${fillPrice.toFixed(2)} | PnL=₹${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
        position = null;
      }
    }

    // ── Step 2: Generate entry signal (only when flat) ───────────────────
    if (!position) {
      const signal = getSignalForStrategy(closeSeries, strategy, aggrMethod);

      if (signal.signal === 'BUY' && signal.confidence >= 0.3) {
        const entryFill = bar.close * (1 + slippagePct);
        const commission = entryFill * commissionPct;

        // Fixed fractional sizing
        const riskAmount   = capital * riskPerTrade;
        const riskPerShare = entryFill * stopLossPct;
        const rawQty       = Math.floor(riskAmount / riskPerShare);
        const qty          = Math.min(rawQty, Math.floor((capital * 0.95) / (entryFill + commission)));

        if (qty > 0) {
          const cost = qty * (entryFill + commission);
          capital   -= cost;

          position = {
            qty,
            entryPrice: parseFloat(entryFill.toFixed(4)),
            entryDate:  bar.date,
            stopLoss:   parseFloat((entryFill * (1 - stopLossPct)).toFixed(4)),
            takeProfit: parseFloat((entryFill * (1 + takeProfitPct)).toFixed(4)),
          };

          logger.debug(`[Backtest] ENTRY: ${bar.date} @${entryFill.toFixed(2)} | qty=${qty} | sl=${position.stopLoss} | tp=${position.takeProfit}`);
        }
      }
    }

    // ── Step 3: Mark-to-market equity ────────────────────────────────────
    const unrealised = position ? (bar.close - position.entryPrice) * position.qty : 0;
    const equity = capital + unrealised;
    equityCurve.push(equity);

    if (equityCurve.length >= 2) {
      const prev = equityCurve[equityCurve.length - 2];
      dailyReturns.push(prev > 0 ? (equity - prev) / prev : 0);
    }
  }

  // ── Close any open position at end of data ───────────────────────────────
  if (position) {
    const lastBar     = prices[prices.length - 1];
    const fillPrice   = lastBar.close * (1 - slippagePct);
    const commission  = position.qty * fillPrice * commissionPct;
    const proceeds    = position.qty * fillPrice - commission;
    const cost        = position.qty * position.entryPrice;
    const pnl         = proceeds - cost;

    capital += proceeds;
    trades.push({
      symbol,
      side:       'BUY',
      entryDate:  position.entryDate,
      entryPrice: position.entryPrice,
      exitDate:   lastBar.date,
      exitPrice:  parseFloat(fillPrice.toFixed(4)),
      quantity:   position.qty,
      pnl:        parseFloat(pnl.toFixed(2)),
      pnlPct:     parseFloat(((pnl / cost) * 100).toFixed(4)),
      commission: parseFloat(commission.toFixed(2)),
      exitReason: 'END_OF_DATA',
    });
  }

  // ── Compute performance metrics ──────────────────────────────────────────
  const summary = computeMetrics({
    symbol, strategy,
    initialCapital,
    finalCapital: capital,
    trades,
    equityCurve,
    dailyReturns,
    startDate: prices[200].date,
    endDate:   prices[prices.length - 1].date,
  });

  logger.info(`[Backtest] Done: ${symbol} | return=${summary.totalReturnPct.toFixed(2)}% | ` +
    `sharpe=${summary.sharpeRatio?.toFixed(3) ?? 'N/A'} | trades=${summary.totalTrades}`);

  return { summary, trades, equityCurve };
}

// ─── Exit logic ───────────────────────────────────────────────────────────────

function checkExit(bar, position, closeSeries, strategy, aggrMethod) {
  // Stop loss hit (use bar low for realism)
  if (bar.low <= position.stopLoss) {
    return { exit: true, exitPrice: position.stopLoss, reason: 'STOP_LOSS' };
  }

  // Take profit hit (use bar high for realism)
  if (bar.high >= position.takeProfit) {
    return { exit: true, exitPrice: position.takeProfit, reason: 'TAKE_PROFIT' };
  }

  // Strategy exit signal
  const signal = getSignalForStrategy(closeSeries, strategy, aggrMethod);
  if (signal.signal === 'SELL' && signal.confidence >= 0.3) {
    return { exit: true, exitPrice: bar.close, reason: 'SIGNAL' };
  }

  return { exit: false };
}

function getSignalForStrategy(closes, strategy, aggrMethod) {
  const MR   = require('../strategies/meanReversion');
  const MA   = require('../strategies/maCrossover');
  const RSI  = require('../strategies/rsiStrategy');

  switch (strategy) {
    case 'MEAN_REVERSION': return MR.generateSignal(closes);
    case 'MA_CROSSOVER':   return MA.generateSignal(closes);
    case 'RSI':            return RSI.generateSignal(closes);
    case 'AGGREGATED':
    default:               return aggregator.aggregate(closes, { method: aggrMethod });
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function computeMetrics({ symbol, strategy, initialCapital, finalCapital, trades,
  equityCurve, dailyReturns, startDate, endDate }) {

  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades  = trades.filter(t => t.pnl <= 0);

  const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));

  const totalReturnPct = ((finalCapital - initialCapital) / initialCapital) * 100;

  // Annualised return (CAGR)
  const days = Math.max(1, (new Date(endDate) - new Date(startDate)) / 86400000);
  const years = days / 365;
  const annualisedReturnPct = (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100;

  // Sharpe ratio
  const sharpe = mu.sharpeRatio(dailyReturns, BT.RISK_FREE_RATE, BT.TRADING_DAYS_PER_YEAR);

  // Max drawdown
  const { maxDrawdown } = mu.maxDrawdown(equityCurve);

  const avgWinPct = winningTrades.length
    ? winningTrades.reduce((s, t) => s + t.pnlPct, 0) / winningTrades.length : 0;
  const avgLossPct = losingTrades.length
    ? losingTrades.reduce((s, t) => s + t.pnlPct, 0) / losingTrades.length : 0;

  return {
    symbol,
    strategy,
    startDate,
    endDate,
    initialCapital:       parseFloat(initialCapital.toFixed(2)),
    finalCapital:         parseFloat(finalCapital.toFixed(2)),
    totalReturnPct:       parseFloat(totalReturnPct.toFixed(4)),
    annualisedReturnPct:  parseFloat(annualisedReturnPct.toFixed(4)),
    sharpeRatio:          sharpe ? parseFloat(sharpe.toFixed(4)) : null,
    maxDrawdownPct:       parseFloat((maxDrawdown * 100).toFixed(4)),
    totalTrades:          trades.length,
    winningTrades:        winningTrades.length,
    losingTrades:         losingTrades.length,
    winRatePct:           trades.length ? parseFloat((winningTrades.length / trades.length * 100).toFixed(2)) : 0,
    profitFactor:         grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(4)) : null,
    avgWinPct:            parseFloat(avgWinPct.toFixed(4)),
    avgLossPct:           parseFloat(avgLossPct.toFixed(4)),
    grossProfit:          parseFloat(grossProfit.toFixed(2)),
    grossLoss:            parseFloat(grossLoss.toFixed(2)),
  };
}

module.exports = { runBacktest };
