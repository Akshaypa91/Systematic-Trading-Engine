// src/engine/backtester.js — UPGRADED
// ─────────────────────────────────────────────────────────────────────────────
// UPGRADES IN THIS FILE
// ──────────────────────
// 1. Transaction costs: uses transactionCosts.js (full NSE breakdown)
// 2. Slippage: uses volatility-scaled slippage model
// 3. Regime detection: uses regimeDetector.js to adjust strategy weights
// 4. Cost tracking in trade records (cost breakdown visible per trade)
// 5. Regime-aware signal generation (weights change based on market)
//
// BACKWARD COMPATIBILITY
// ───────────────────────
// • All original function signatures preserved
// • Default params unchanged — zero breaking changes
// • New fields added to trade records (additive, not breaking)
// • USE_SIMPLIFIED_COSTS=true (default) keeps legacy single-rate behaviour
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu      = require('../utils/mathUtils');
const C       = require('../config/constants');
const logger  = require('../config/logger');
const txCosts = require('../utils/transactionCosts');
const { detectRegime } = require('./regimeDetector');

const strategyCore = require('./strategyCore');

// Valid strategy keys for backtesting (mirrors strategyCore.VALID minus BOLLINGER
// which the backtest loop doesn't wire an exit for yet).
const strategies = {
  MEAN_REVERSION: true, MA_CROSSOVER: true, RSI: true, AGGREGATED: true,
};

const BT = C.BACKTEST;
const R  = C.RISK;

/**
 * Run a backtest for a single symbol.
 *
 * SIMULATION MODEL
 * ─────────────────
 * • Iterate bars chronologically. No future data used.
 * • On each bar: (1) check exit conditions on open position,
 *                (2) evaluate entry signal when flat.
 * • Entry fill  = applySlippage(bar.close, 'BUY',  realisedVol)
 * • Exit fill   = applySlippage(exitPrice,'SELL', realisedVol)
 * • Transaction costs deducted on BOTH entry and exit using full NSE model.
 * • Stop-loss checked vs bar.low; take-profit vs bar.high.
 * • Regime detection every REGIME_CHECK_EVERY bars for efficiency.
 *
 * @param {{\n *   symbol, prices, initialCapital, commissionPct, slippagePct,\n *   stopLossPct, takeProfitPct, riskPerTrade, strategy, aggrMethod,\n *   minConfidence, useRegimeDetection\n * }} config
 */
function runBacktest(config) {
  const {
    symbol,
    prices,
    initialCapital   = BT.DEFAULT_CAPITAL,
    commissionPct    = BT.COMMISSION_PCT,    // kept for backward compat
    slippagePct      = BT.SLIPPAGE_PCT,      // kept for backward compat
    stopLossPct      = R.DEFAULT_STOP_LOSS_PCT,
    takeProfitPct    = R.DEFAULT_TAKE_PROFIT_PCT,
    riskPerTrade     = R.MAX_RISK_PER_TRADE_PCT,
    strategy         = 'AGGREGATED',
    aggrMethod       = 'weighted',
    minConfidence    = 0.30,
    useRegimeDetection = true,               // NEW: enable/disable regime-aware signals
  } = config;

  if (!Array.isArray(prices) || prices.length < 201)
    throw new RangeError(`Backtest requires ≥201 price bars, got ${prices?.length ?? 0}`);

  const stratKey = strategy.toUpperCase();
  if (!strategies[stratKey])
    throw new Error(`Unknown strategy: "${strategy}". Valid: ${Object.keys(strategies).join(', ')}`);

  logger.info(
    `[Backtest] ${symbol} | strategy=${stratKey} | bars=${prices.length} | ` +
    `capital=₹${initialCapital.toLocaleString()} | regime=${useRegimeDetection}`
  );

  let capital      = initialCapital;
  let position     = null;
  const trades     = [];
  const equityCurve = [capital];
  const dailyReturns = [];
  const allCloses   = prices.map(p => p.close);

  // Regime state — recomputed every N bars to save CPU
  const REGIME_CHECK_EVERY = 10;
  let currentRegime = null;
  let regimeWeights = null;

  // ── Walk-forward ──────────────────────────────────────────────────────────
  for (let i = 200; i < prices.length; i++) {
    const bar    = prices[i];
    const closes = allCloses.slice(0, i + 1);

    // Compute realised vol for slippage scaling (20-bar lookback)
    const realisedVol = i >= 220
      ? mu.annualisedVol(allCloses.slice(i - 20, i + 1))
      : null;

    // Regime detection (throttled)
    if (useRegimeDetection && stratKey === 'AGGREGATED' && i % REGIME_CHECK_EVERY === 0) {
      const rd  = detectRegime(closes);
      currentRegime = rd.regime;
      regimeWeights = rd.weights;
    }

    // ── 1. Exit open position ────────────────────────────────────────────────
    if (position) {
      const exit = _checkExit(bar, position, closes, stratKey, aggrMethod, minConfidence);
      if (exit) {
        // Apply slippage on exit (sell side)
        const slipResult   = txCosts.applySlippage({ side: 'SELL', marketPrice: exit.price, realisedVol });
        const fillPrice    = slipResult.fillPrice;

        // Transaction costs on exit
        const tx           = txCosts.computeCosts({ side: 'SELL', price: fillPrice, quantity: position.qty });

        const proceeds     = position.qty * fillPrice - tx.totalCost;
        const cost         = position.qty * position.entryPrice;
        const pnl          = proceeds - cost;

        capital += proceeds;

        trades.push({
          symbol,
          side:          'BUY',
          entryDate:     position.entryDate,
          entryPrice:    position.entryPrice,
          exitDate:      bar.date,
          exitPrice:     parseFloat(fillPrice.toFixed(4)),
          quantity:      position.qty,
          pnl:           parseFloat(pnl.toFixed(2)),
          pnlPct:        parseFloat(((pnl / cost) * 100).toFixed(4)),
          // Cost breakdown (NEW fields — backward compatible additions)
          entryCost:     position.entryCost,
          exitCost:      parseFloat(tx.totalCost.toFixed(4)),
          totalCost:     parseFloat((position.entryCost + tx.totalCost).toFixed(4)),
          slippageCost:  parseFloat((position.entrySlippage + slipResult.slippageCost).toFixed(4)),
          commission:    parseFloat(tx.totalCost.toFixed(2)),  // kept for compat
          exitReason:    exit.reason,
          regime:        currentRegime,
        });

        logger.debug(
          `[Backtest] EXIT ${exit.reason} | ${bar.date} @₹${fillPrice.toFixed(2)} | ` +
          `PnL=₹${pnl.toFixed(2)} (${((pnl / cost) * 100).toFixed(2)}%) | ` +
          `costs=₹${(position.entryCost + tx.totalCost).toFixed(2)}`
        );
        position = null;
      }
    }

    // ── 2. Entry signal (only when flat) ─────────────────────────────────────
    if (!position) {
      const sig = _getSignal(closes, stratKey, aggrMethod, regimeWeights);
      if (sig.signal === 'BUY' && sig.confidence >= minConfidence) {
        // Apply slippage on entry (buy side)
        const slipResult = txCosts.applySlippage({ side: 'BUY', marketPrice: bar.close, realisedVol });
        const entryFill  = slipResult.fillPrice;

        // Transaction costs on entry
        const riskPerShr = entryFill * stopLossPct;
        const maxCapital = capital * 0.95;

        let qty = riskPerShr > 0
          ? Math.floor((capital * riskPerTrade) / riskPerShr)
          : 0;

        // Compute entry tx cost to accurately cap to affordable quantity
        const estTxPct = C.TRANSACTION_COSTS.USE_SIMPLIFIED
          ? commissionPct
          : C.TRANSACTION_COSTS.BROKERAGE_PCT + C.TRANSACTION_COSTS.STAMP_DUTY_PCT;

        qty = Math.min(qty, Math.floor(maxCapital / (entryFill * (1 + estTxPct))));

        if (qty > 0) {
          const tx         = txCosts.computeCosts({ side: 'BUY', price: entryFill, quantity: qty });
          const totalEntry = qty * entryFill + tx.totalCost;

          if (totalEntry <= capital) {
            capital -= totalEntry;
            position = {
              qty,
              entryPrice:   parseFloat(entryFill.toFixed(4)),
              entryDate:    bar.date,
              stopLoss:     parseFloat((entryFill * (1 - stopLossPct)).toFixed(4)),
              takeProfit:   parseFloat((entryFill * (1 + takeProfitPct)).toFixed(4)),
              // NEW cost tracking fields
              entryCost:    parseFloat(tx.totalCost.toFixed(4)),
              entrySlippage:slipResult.slippageCost,
            };
            logger.debug(
              `[Backtest] ENTRY | ${bar.date} @₹${entryFill.toFixed(2)} | ` +
              `qty=${qty} | SL=₹${position.stopLoss} | TP=₹${position.takeProfit} | ` +
              `costs=₹${tx.totalCost.toFixed(2)} | regime=${currentRegime || 'N/A'}`
            );
          }
        }
      }
    }

    // ── 3. Mark-to-market ─────────────────────────────────────────────────────
    const mtm    = position ? (bar.close - position.entryPrice) * position.qty : 0;
    const equity = capital + mtm;
    equityCurve.push(equity);
    if (equityCurve.length >= 2) {
      const prev = equityCurve[equityCurve.length - 2];
      dailyReturns.push(prev > 0 ? (equity - prev) / prev : 0);
    }
  }

  // ── Force-close open position at end of data ──────────────────────────────
  if (position) {
    const last       = prices[prices.length - 1];
    const slipResult = txCosts.applySlippage({ side: 'SELL', marketPrice: last.close });
    const fillPrice  = slipResult.fillPrice;
    const tx         = txCosts.computeCosts({ side: 'SELL', price: fillPrice, quantity: position.qty });
    const proceeds   = position.qty * fillPrice - tx.totalCost;
    const cost       = position.qty * position.entryPrice;
    const pnl        = proceeds - cost;
    capital += proceeds;
    trades.push({
      symbol,
      side: 'BUY', entryDate: position.entryDate, entryPrice: position.entryPrice,
      exitDate: last.date, exitPrice: parseFloat(fillPrice.toFixed(4)),
      quantity: position.qty, pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: parseFloat(((pnl / cost) * 100).toFixed(4)),
      entryCost: position.entryCost, exitCost: parseFloat(tx.totalCost.toFixed(4)),
      totalCost: parseFloat((position.entryCost + tx.totalCost).toFixed(4)),
      slippageCost: parseFloat((position.entrySlippage + slipResult.slippageCost).toFixed(4)),
      commission: parseFloat(tx.totalCost.toFixed(2)), exitReason: 'END_OF_DATA',
      regime: currentRegime,
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
    `trades=${summary.totalTrades} | winRate=${summary.winRatePct.toFixed(1)}% | ` +
    `totalCosts=₹${summary.totalTransactionCosts?.toFixed(2) ?? 'N/A'}`
  );

  return { summary, trades, equityCurve };
}

// ── Exit check ────────────────────────────────────────────────────────────────

function _checkExit(bar, position, closes, stratKey, aggrMethod, minConfidence) {
  if (isFinite(bar.low)  && bar.low  <= position.stopLoss)
    return { price: position.stopLoss,   reason: 'STOP_LOSS' };
  if (isFinite(bar.high) && bar.high >= position.takeProfit)
    return { price: position.takeProfit, reason: 'TAKE_PROFIT' };

  const sig = _getSignal(closes, stratKey, aggrMethod);
  if (sig.signal === 'SELL' && sig.confidence >= minConfidence)
    return { price: bar.close, reason: 'SIGNAL' };

  return null;
}

// ── Signal dispatch (regime-aware for AGGREGATED) ─────────────────────────────

function _getSignal(closes, stratKey, aggrMethod, regimeWeights = null) {
  // Delegates to the shared strategyCore so backtest signals are computed by the
  // exact same code as live/paper signals — identical bars → identical decision.
  return strategyCore.evaluate(stratKey, closes, {
    method: aggrMethod,
    overrideWeights: regimeWeights || undefined,
  });
}

// ── Performance metrics ───────────────────────────────────────────────────────

function _computeMetrics({ symbol, strategy, initialCapital, finalCapital,
  trades, equityCurve, dailyReturns, startDate, endDate }) {

  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;

  const daysDiff = Math.max(1, (new Date(endDate) - new Date(startDate)) / 86400000);
  const years    = daysDiff / 365;
  const cagr     = (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100;

  const sharpe   = mu.sharpeRatio(dailyReturns, BT.RISK_FREE_RATE, BT.TRADING_DAYS_PER_YEAR);
  const sortino  = mu.sortinoRatio(dailyReturns, BT.RISK_FREE_RATE, BT.TRADING_DAYS_PER_YEAR);
  const { maxDrawdown } = mu.maxDrawdown(equityCurve);

  const avgWinPct  = wins.length   ? wins.reduce((s, t)   => s + t.pnlPct, 0) / wins.length   : 0;
  const avgLossPct = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

  const calmar = maxDrawdown > 0 ? parseFloat((cagr / (maxDrawdown * 100)).toFixed(4)) : null;

  // NEW: Aggregate cost metrics
  const totalTxCosts = trades.reduce((s, t) => s + (t.totalCost || 0), 0);
  const totalSlippage = trades.reduce((s, t) => s + (t.slippageCost || 0), 0);

  // Regime breakdown
  const regimeCounts = {};
  trades.forEach(t => {
    if (t.regime) regimeCounts[t.regime] = (regimeCounts[t.regime] || 0) + 1;
  });

  return {
    symbol, strategy, startDate, endDate,
    initialCapital:        parseFloat(initialCapital.toFixed(2)),
    finalCapital:          parseFloat(finalCapital.toFixed(2)),
    totalReturnPct:        parseFloat(totalReturn.toFixed(4)),
    annualisedReturnPct:   parseFloat(cagr.toFixed(4)),
    sharpeRatio:           sharpe  !== null ? parseFloat(sharpe.toFixed(4))  : null,
    sortinoRatio:          sortino !== null ? parseFloat(sortino.toFixed(4)) : null,
    calmarRatio:           calmar,
    maxDrawdownPct:        parseFloat((maxDrawdown * 100).toFixed(4)),
    totalTrades:           trades.length,
    winningTrades:         wins.length,
    losingTrades:          losses.length,
    winRatePct:            trades.length ? parseFloat((wins.length / trades.length * 100).toFixed(2)) : 0,
    profitFactor:          grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(4)) : null,
    avgWinPct:             parseFloat(avgWinPct.toFixed(4)),
    avgLossPct:            parseFloat(avgLossPct.toFixed(4)),
    grossProfit:           parseFloat(grossProfit.toFixed(2)),
    grossLoss:             parseFloat(grossLoss.toFixed(2)),
    // NEW cost fields
    totalTransactionCosts: parseFloat(totalTxCosts.toFixed(2)),
    totalSlippageCosts:    parseFloat(totalSlippage.toFixed(2)),
    costDragPct:           parseFloat((totalTxCosts / initialCapital * 100).toFixed(4)),
    regimeBreakdown:       regimeCounts,
  };
}

module.exports = { runBacktest };
