// src/engine/backtester.js
// Walk-forward backtesting engine — zero lookahead, realistic fills.

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

// Require strategies once at module load — NOT inside the hot loop
const strategies = {
  MEAN_REVERSION: require('../strategies/meanReversion'),
  MA_CROSSOVER:   require('../strategies/maCrossover'),
  RSI:            require('../strategies/rsiStrategy'),
  AGGREGATED:     require('../strategies/aggregator'),
};

const BT = C.BACKTEST;
const R  = C.RISK;

/**
 * Run a backtest for a single symbol.
 *
 * SIMULATION MODEL
 * ─────────────────
 * • Iterate bars chronologically.  No future data ever used.
 * • On each bar: (1) check exit conditions on open position,
 *                (2) evaluate entry signal when flat.
 * • Entry fill  = bar.close × (1 + slippage)   [worst-case long fill]
 * • Exit fill   = exitPrice × (1 − slippage)   [conservative]
 * • Stop-loss checked vs bar.low;  take-profit vs bar.high.
 * • Commission deducted on both entry and exit sides.
 *
 * POSITION SIZING
 * ───────────────
 * Fixed Fractional: qty = floor( (capital × riskPerTrade) / (entryFill × stopLossPct) )
 * Capped at 95% of remaining capital to prevent over-allocation.
 *
 * @param {{
 *   symbol:         string,
 *   prices:         Array<{date,open,high,low,close,volume?}>,
 *   initialCapital: number,
 *   commissionPct:  number,
 *   slippagePct:    number,
 *   stopLossPct:    number,
 *   takeProfitPct:  number,
 *   riskPerTrade:   number,
 *   strategy:       'AGGREGATED'|'MEAN_REVERSION'|'MA_CROSSOVER'|'RSI',
 *   aggrMethod:     'weighted'|'majority',
 *   minConfidence:  number,   // signal confidence threshold (default 0.3)
 * }} config
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
    minConfidence  = 0.30,
  } = config;

  if (!Array.isArray(prices) || prices.length < 201) {
    throw new RangeError(
      `Backtest requires ≥201 price bars, got ${prices?.length ?? 0}`
    );
  }

  const stratKey = strategy.toUpperCase();
  if (!strategies[stratKey]) {
    throw new Error(`Unknown strategy: "${strategy}". Valid: ${Object.keys(strategies).join(', ')}`);
  }

  logger.info(
    `[Backtest] ${symbol} | strategy=${stratKey} | bars=${prices.length} | ` +
    `capital=₹${initialCapital.toLocaleString()}`
  );

  let capital = initialCapital;
  let position = null;           // { qty, entryPrice, entryDate, stopLoss, takeProfit }
  const trades       = [];
  const equityCurve  = [capital];
  const dailyReturns = [];

  // Pre-extract close prices array once — avoid repeated .map() in the loop
  const allCloses = prices.map(p => p.close);

  // ── Walk-forward ──────────────────────────────────────────────────────────
  for (let i = 200; i < prices.length; i++) {
    const bar    = prices[i];
    // Slice is O(n) but unavoidable for strategy context.
    // Critical fix: we only compute signal when needed (not on every bar unconditionally).
    const closes = allCloses.slice(0, i + 1);

    // ── 1. Exit open position ──────────────────────────────────────────────
    if (position) {
      const exit = _checkExit(bar, position, closes, stratKey, aggrMethod, minConfidence);
      if (exit) {
        const fillPrice  = exit.price * (1 - slippagePct);
        const commission = position.qty * fillPrice * commissionPct;
        const proceeds   = position.qty * fillPrice - commission;
        const cost       = position.qty * position.entryPrice;
        const pnl        = proceeds - cost;

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
          pnlPct:     parseFloat(((pnl / cost) * 100).toFixed(4)),
          commission: parseFloat(commission.toFixed(2)),
          exitReason: exit.reason,
        });

        logger.debug(
          `[Backtest] EXIT ${exit.reason} | ${bar.date} @₹${fillPrice.toFixed(2)} | ` +
          `PnL=₹${pnl.toFixed(2)} (${((pnl / cost) * 100).toFixed(2)}%)`
        );
        position = null;
      }
    }

    // ── 2. Entry signal (only when flat) ──────────────────────────────────
    if (!position) {
      const sig = _getSignal(closes, stratKey, aggrMethod);
      if (sig.signal === 'BUY' && sig.confidence >= minConfidence) {
        const entryFill  = bar.close * (1 + slippagePct);
        const commission = entryFill * commissionPct;
        const riskPerShr = entryFill * stopLossPct;
        const maxCapital = capital * 0.95;          // never use >95% of remaining capital

        let qty = riskPerShr > 0
          ? Math.floor((capital * riskPerTrade) / riskPerShr)
          : 0;
        // Cap to affordable quantity including entry commission
        qty = Math.min(qty, Math.floor(maxCapital / (entryFill + commission)));

        if (qty > 0) {
          capital -= qty * (entryFill + commission);
          position = {
            qty,
            entryPrice: parseFloat(entryFill.toFixed(4)),
            entryDate:  bar.date,
            stopLoss:   parseFloat((entryFill * (1 - stopLossPct)).toFixed(4)),
            takeProfit: parseFloat((entryFill * (1 + takeProfitPct)).toFixed(4)),
          };
          logger.debug(
            `[Backtest] ENTRY | ${bar.date} @₹${entryFill.toFixed(2)} | ` +
            `qty=${qty} | SL=₹${position.stopLoss} | TP=₹${position.takeProfit}`
          );
        }
      }
    }

    // ── 3. Mark-to-market ─────────────────────────────────────────────────
    const mtm    = position ? (bar.close - position.entryPrice) * position.qty : 0;
    const equity = capital + mtm;
    equityCurve.push(equity);
    if (equityCurve.length >= 2) {
      const prev = equityCurve[equityCurve.length - 2];
      dailyReturns.push(prev > 0 ? (equity - prev) / prev : 0);
    }
  }

  // ── Force-close any open position at end of data ──────────────────────────
  if (position) {
    const last      = prices[prices.length - 1];
    const fillPrice = last.close * (1 - slippagePct);
    const commission = position.qty * fillPrice * commissionPct;
    const proceeds   = position.qty * fillPrice - commission;
    const cost       = position.qty * position.entryPrice;
    const pnl        = proceeds - cost;
    capital += proceeds;
    trades.push({
      symbol,
      side:       'BUY',
      entryDate:  position.entryDate,
      entryPrice: position.entryPrice,
      exitDate:   last.date,
      exitPrice:  parseFloat(fillPrice.toFixed(4)),
      quantity:   position.qty,
      pnl:        parseFloat(pnl.toFixed(2)),
      pnlPct:     parseFloat(((pnl / cost) * 100).toFixed(4)),
      commission: parseFloat(commission.toFixed(2)),
      exitReason: 'END_OF_DATA',
    });
  }

  const summary = _computeMetrics({
    symbol, strategy: stratKey, initialCapital,
    finalCapital: capital, trades, equityCurve, dailyReturns,
    startDate: prices[200].date, endDate: prices[prices.length - 1].date,
  });

  logger.info(
    `[Backtest] Done | return=${summary.totalReturnPct.toFixed(2)}% | ` +
    `sharpe=${summary.sharpeRatio?.toFixed(3) ?? 'N/A'} | ` +
    `trades=${summary.totalTrades} | winRate=${summary.winRatePct.toFixed(1)}%`
  );

  return { summary, trades, equityCurve };
}

// ── Exit check ────────────────────────────────────────────────────────────────

function _checkExit(bar, position, closes, stratKey, aggrMethod, minConfidence) {
  // Hard exits: use intrabar high/low for realism
  if (isFinite(bar.low)  && bar.low  <= position.stopLoss)
    return { price: position.stopLoss,   reason: 'STOP_LOSS' };
  if (isFinite(bar.high) && bar.high >= position.takeProfit)
    return { price: position.takeProfit, reason: 'TAKE_PROFIT' };

  // Signal-based exit
  const sig = _getSignal(closes, stratKey, aggrMethod);
  if (sig.signal === 'SELL' && sig.confidence >= minConfidence)
    return { price: bar.close, reason: 'SIGNAL' };

  return null;
}

// ── Signal dispatch ───────────────────────────────────────────────────────────

function _getSignal(closes, stratKey, aggrMethod) {
  switch (stratKey) {
    case 'MEAN_REVERSION': return strategies.MEAN_REVERSION.generateSignal(closes);
    case 'MA_CROSSOVER':   return strategies.MA_CROSSOVER.generateSignal(closes);
    case 'RSI':            return strategies.RSI.generateSignal(closes);
    case 'AGGREGATED':
    default:               return strategies.AGGREGATED.aggregate(closes, { method: aggrMethod });
  }
}

// ── Performance metrics ───────────────────────────────────────────────────────

function _computeMetrics({
  symbol, strategy, initialCapital, finalCapital,
  trades, equityCurve, dailyReturns, startDate, endDate,
}) {
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;

  const daysDiff = Math.max(1, (new Date(endDate) - new Date(startDate)) / 86400000);
  const years    = daysDiff / 365;
  const cagr     = (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100;

  const sharpe  = mu.sharpeRatio(dailyReturns, BT.RISK_FREE_RATE, BT.TRADING_DAYS_PER_YEAR);
  const sortino = mu.sortinoRatio(dailyReturns, BT.RISK_FREE_RATE, BT.TRADING_DAYS_PER_YEAR);
  const { maxDrawdown } = mu.maxDrawdown(equityCurve);

  const avgWinPct  = wins.length   ? wins.reduce((s, t)   => s + t.pnlPct, 0) / wins.length   : 0;
  const avgLossPct = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

  const calmar = maxDrawdown > 0 ? parseFloat((cagr / (maxDrawdown * 100)).toFixed(4)) : null;

  return {
    symbol,
    strategy,
    startDate,
    endDate,
    initialCapital:       parseFloat(initialCapital.toFixed(2)),
    finalCapital:         parseFloat(finalCapital.toFixed(2)),
    totalReturnPct:       parseFloat(totalReturn.toFixed(4)),
    annualisedReturnPct:  parseFloat(cagr.toFixed(4)),
    sharpeRatio:          sharpe  !== null ? parseFloat(sharpe.toFixed(4))  : null,
    sortinoRatio:         sortino !== null ? parseFloat(sortino.toFixed(4)) : null,
    calmarRatio:          calmar,
    maxDrawdownPct:       parseFloat((maxDrawdown * 100).toFixed(4)),
    totalTrades:          trades.length,
    winningTrades:        wins.length,
    losingTrades:         losses.length,
    winRatePct:           trades.length ? parseFloat((wins.length / trades.length * 100).toFixed(2)) : 0,
    profitFactor:         grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(4)) : null,
    avgWinPct:            parseFloat(avgWinPct.toFixed(4)),
    avgLossPct:           parseFloat(avgLossPct.toFixed(4)),
    grossProfit:          parseFloat(grossProfit.toFixed(2)),
    grossLoss:            parseFloat(grossLoss.toFixed(2)),
  };
}

module.exports = { runBacktest };
