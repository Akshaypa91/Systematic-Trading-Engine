// src/engine/portfolioEngine.js — FULL PORTFOLIO ENGINE
// ─────────────────────────────────────────────────────────────────────────────
//
// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════
//
// This module provides PORTFOLIO-LEVEL trading on top of the existing
// single-asset backtester. It does NOT touch runBacktest() — backward compat
// is fully preserved. Instead it adds:
//
//   PortfolioState        — live mutable state of the portfolio
//   Signal ranking        — score signals across N symbols, pick top K
//   Capital allocation    — 3 methods: equal / vol-parity / score-weighted
//   Position sizing       — fixed-fractional or vol-scaled per asset
//   Risk guards           — max positions, max drawdown, exposure limits
//   Portfolio backtester  — runPortfolioBacktest() — multi-asset simulation
//
// ═══════════════════════════════════════════════════════════════════════════
// KEY DESIGN DECISIONS
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. CHRONOLOGICAL INTEGRITY
//    All assets share the same timeline. On each bar date, we process
//    exits before entries (no look-ahead). If symbol A and B both have data
//    for 2023-01-15, we check exits on existing positions first, then check
//    new entries.
//
// 2. CAPITAL ACCOUNTING
//    cash = total capital − Σ(qty_i × entryPrice_i) − Σ(costs_i)
//    MTM equity = cash + Σ(qty_i × currentPrice_i)
//    Never allow cash to go negative — position rejected if insufficient.
//
// 3. SIGNAL RANKING & TOP-N SELECTION
//    On each bar: generate signals for all eligible symbols, rank by
//    confidence × signal_direction, pick top N that pass risk filters.
//    This prevents over-allocation when 10 symbols all signal BUY.
//
// 4. MAX PORTFOLIO DRAWDOWN CIRCUIT BREAKER
//    If portfolio equity drops > MAX_PORTFOLIO_DRAWDOWN_PCT from its peak,
//    stop entering new positions (but let existing positions run).
//    This prevents compounding losses during regime breaks.
//
// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════
//
//   runPortfolioBacktest(config)   — multi-asset historical simulation
//   PortfolioState class           — live portfolio state management
//   allocateCapital(params)        — capital split across assets (preserved)
//   computePortfolioState(params)  — snapshot metrics (preserved)
//   volScaledSize(params)          — vol-parity position sizing (preserved)
//   checkPortfolioLimits(params)   — risk gate pre-trade (preserved)
//   rankSignals(signals)           — score + sort + filter signals
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu      = require('../utils/mathUtils');
const C       = require('../config/constants');
const logger  = require('../config/logger');
const txCosts = require('../utils/transactionCosts');
const { detectRegime } = require('./regimeDetector');

const PC = C.PORTFOLIO  || {};
const RC = C.RISK       || {};
const BT = C.BACKTEST   || {};

// Strategy map — same as single-asset backtester
const strategies = {
  MEAN_REVERSION: require('../strategies/meanReversion'),
  MA_CROSSOVER:   require('../strategies/maCrossover'),
  RSI:            require('../strategies/rsiStrategy'),
  AGGREGATED:     require('../strategies/aggregator'),
};

// ═══════════════════════════════════════════════════════════════════════════
// PortfolioState — mutable live state of the portfolio
// ═══════════════════════════════════════════════════════════════════════════

class PortfolioState {
  /**
   * @param {{ initialCapital: number, maxPositions?: number, maxDrawdownPct?: number }} opts
   */
  constructor({
    initialCapital,
    maxPositions    = RC.MAX_OPEN_POSITIONS   || 10,
    maxDrawdownPct  = RC.MAX_DAILY_LOSS_PCT   || 0.15,
    maxSinglePct    = RC.MAX_SINGLE_ASSET_PCT || 0.20,
    maxExposurePct  = RC.MAX_PORTFOLIO_EXPOSURE || 0.95,
  } = {}) {
    if (!initialCapital || initialCapital <= 0)
      throw new RangeError('[PortfolioState] initialCapital must be > 0');

    this.initialCapital = initialCapital;
    this.cash           = initialCapital;
    this.maxPositions   = maxPositions;
    this.maxDrawdownPct = maxDrawdownPct;
    this.maxSinglePct   = maxSinglePct;
    this.maxExposurePct = maxExposurePct;

    // positions: Map<symbol, { qty, entryPrice, entryDate, stopLoss, takeProfit, entryCost, entrySlippage }>
    this.positions = new Map();

    // Equity tracking
    this.peakEquity   = initialCapital;
    this.equityCurve  = [initialCapital];
    this.dailyReturns = [];

    // Trade log
    this.trades = [];
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  /**
   * Compute current total equity using provided current prices.
   * @param {Map<string, number>} currentPrices  symbol → current close price
   * @returns {number}
   */
  totalEquity(currentPrices) {
    let mtm = 0;
    for (const [sym, pos] of this.positions) {
      const price = currentPrices.get(sym);
      if (price != null) mtm += pos.qty * price;
    }
    return this.cash + mtm;
  }

  /**
   * Record bar-end MTM and update peak / drawdown state.
   * @param {Map<string, number>} currentPrices
   * @returns {{ equity: number, drawdown: number, circuitBreaker: boolean }}
   */
  recordBarEnd(currentPrices) {
    const equity = this.totalEquity(currentPrices);
    this.equityCurve.push(equity);

    if (this.equityCurve.length >= 2) {
      const prev = this.equityCurve[this.equityCurve.length - 2];
      this.dailyReturns.push(prev > 0 ? (equity - prev) / prev : 0);
    }

    if (equity > this.peakEquity) this.peakEquity = equity;

    const drawdown       = this.peakEquity > 0 ? (this.peakEquity - equity) / this.peakEquity : 0;
    const circuitBreaker = drawdown >= this.maxDrawdownPct;

    return { equity, drawdown, circuitBreaker };
  }

  // ── Risk gates ───────────────────────────────────────────────────────────

  /**
   * Check all pre-trade risk conditions.
   * @param {{ symbol, positionValue, currentPrices }} params
   * @returns {{ approved: boolean, reasons: string[] }}
   */
  canEnter({ symbol, positionValue, currentPrices = new Map() }) {
    const reasons = [];

    if (this.positions.has(symbol))
      reasons.push(`Already holding ${symbol}`);

    if (this.positions.size >= this.maxPositions)
      reasons.push(`Max positions (${this.maxPositions}) reached`);

    const totalEquity = this.totalEquity(currentPrices);

    if (positionValue > this.cash)
      reasons.push(`Insufficient cash: need ₹${positionValue.toFixed(0)}, have ₹${this.cash.toFixed(0)}`);

    const singlePct = positionValue / Math.max(totalEquity, 1);
    if (singlePct > this.maxSinglePct)
      reasons.push(`Position ${(singlePct * 100).toFixed(1)}% exceeds max ${(this.maxSinglePct * 100).toFixed(0)}%`);

    // Total exposure check
    let exposedValue = 0;
    for (const [sym, pos] of this.positions) {
      const p = currentPrices.get(sym) ?? pos.entryPrice;
      exposedValue += pos.qty * p;
    }
    const newExposurePct = (exposedValue + positionValue) / Math.max(totalEquity, 1);
    if (newExposurePct > this.maxExposurePct)
      reasons.push(`Total exposure ${(newExposurePct * 100).toFixed(1)}% would exceed ${(this.maxExposurePct * 100).toFixed(0)}%`);

    // Drawdown circuit breaker
    const dd = this.peakEquity > 0 ? (this.peakEquity - totalEquity) / this.peakEquity : 0;
    if (dd >= this.maxDrawdownPct)
      reasons.push(`Portfolio drawdown ${(dd * 100).toFixed(1)}% ≥ limit ${(this.maxDrawdownPct * 100).toFixed(0)}% — new entries blocked`);

    return { approved: reasons.length === 0, reasons };
  }

  // ── Trade execution ───────────────────────────────────────────────────────

  /**
   * Open a new position. Deducts cost from cash.
   * @returns {{ success: boolean, reason?: string }}
   */
  openPosition({ symbol, qty, entryPrice, entryDate, stopLoss, takeProfit, entryCost = 0, entrySlippage = 0 }) {
    const totalCost = qty * entryPrice + entryCost;
    if (totalCost > this.cash)
      return { success: false, reason: `Insufficient cash: need ₹${totalCost.toFixed(0)}` };

    this.cash -= totalCost;
    this.positions.set(symbol, { qty, entryPrice, entryDate, stopLoss, takeProfit, entryCost, entrySlippage });
    logger.debug(`[Portfolio] OPEN ${symbol} | qty=${qty} @₹${entryPrice.toFixed(2)} | cash=₹${this.cash.toFixed(0)}`);
    return { success: true };
  }

  /**
   * Close an existing position. Returns proceeds to cash.
   * @returns {{ trade: Object }|null}
   */
  closePosition({ symbol, exitPrice, exitDate, exitReason, exitCost = 0, exitSlippage = 0 }) {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    const proceeds = pos.qty * exitPrice - exitCost;
    const cost     = pos.qty * pos.entryPrice;
    const pnl      = proceeds - cost;

    this.cash += proceeds;
    this.positions.delete(symbol);

    const trade = {
      symbol,
      side:         'BUY',
      entryDate:    pos.entryDate,
      entryPrice:   pos.entryPrice,
      exitDate,
      exitPrice:    parseFloat(exitPrice.toFixed(4)),
      quantity:     pos.qty,
      pnl:          parseFloat(pnl.toFixed(2)),
      pnlPct:       parseFloat(((pnl / cost) * 100).toFixed(4)),
      entryCost:    pos.entryCost,
      exitCost:     parseFloat(exitCost.toFixed(4)),
      totalCost:    parseFloat((pos.entryCost + exitCost).toFixed(4)),
      slippageCost: parseFloat((pos.entrySlippage + exitSlippage).toFixed(4)),
      exitReason,
    };
    this.trades.push(trade);

    logger.debug(`[Portfolio] CLOSE ${symbol} | @₹${exitPrice.toFixed(2)} | PnL=₹${pnl.toFixed(2)} (${((pnl/cost)*100).toFixed(2)}%)`);
    return { trade };
  }

  // ── Snapshot (for API / reporting) ───────────────────────────────────────

  snapshot(currentPrices = new Map()) {
    const equity = this.totalEquity(currentPrices);
    let marketValue = 0;
    const positionList = [];

    for (const [sym, pos] of this.positions) {
      const price = currentPrices.get(sym) ?? pos.entryPrice;
      const mv    = pos.qty * price;
      const cb    = pos.qty * pos.entryPrice;
      const pnl   = mv - cb;
      marketValue += mv;
      positionList.push({
        symbol: sym, qty: pos.qty, entryPrice: pos.entryPrice,
        currentPrice: price, marketValue: parseFloat(mv.toFixed(2)),
        costBasis: parseFloat(cb.toFixed(2)),
        unrealisedPnL: parseFloat(pnl.toFixed(2)),
        pnlPct: parseFloat(((pnl / cb) * 100).toFixed(4)),
        stopLoss: pos.stopLoss, takeProfit: pos.takeProfit,
      });
    }

    const dd = this.peakEquity > 0 ? (this.peakEquity - equity) / this.peakEquity : 0;
    return {
      totalEquity:      parseFloat(equity.toFixed(2)),
      cash:             parseFloat(this.cash.toFixed(2)),
      marketValue:      parseFloat(marketValue.toFixed(2)),
      cashPct:          parseFloat((equity > 0 ? this.cash / equity : 1).toFixed(4)),
      deployedPct:      parseFloat((equity > 0 ? marketValue / equity : 0).toFixed(4)),
      positionCount:    this.positions.size,
      currentDrawdown:  parseFloat((dd * 100).toFixed(4)),
      peakEquity:       parseFloat(this.peakEquity.toFixed(2)),
      positions:        positionList,
      totalTrades:      this.trades.length,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Signal Ranking — pick best N signals from a universe
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rank signals from multiple symbols and select top N by score.
 *
 * Ranking formula:
 *   score = confidence × signal_direction_multiplier
 *   direction: BUY=+1, SELL=0 (we only go long in this engine), HOLD=−1
 *
 * @param {Array<{
 *   symbol:     string,
 *   signal:     'BUY'|'SELL'|'HOLD',
 *   confidence: number,
 *   recentVol?: number,
 *   extra?:     Object,
 * }>} signals
 * @param {{ topN?: number, minConfidence?: number, buyOnly?: boolean }} opts
 * @returns {Array} — sorted descending by score, sliced to topN
 */
function rankSignals(signals, opts = {}) {
  const { topN = 5, minConfidence = 0.25, buyOnly = true } = opts;

  if (!Array.isArray(signals) || signals.length === 0) return [];

  return signals
    .filter(s => {
      if (buyOnly && s.signal !== 'BUY') return false;
      if ((s.confidence || 0) < minConfidence) return false;
      return true;
    })
    .map(s => ({
      ...s,
      score: parseFloat(((s.confidence || 0) * (s.signal === 'BUY' ? 1 : 0)).toFixed(6)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ═══════════════════════════════════════════════════════════════════════════
// Capital Allocation (preserved + extended)
// ═══════════════════════════════════════════════════════════════════════════

function allocateCapital({ totalCapital, assets, method = (PC.ALLOC_METHOD || 'equal') }) {
  if (!totalCapital || totalCapital <= 0)
    throw new RangeError('[Portfolio] totalCapital must be > 0');
  if (!Array.isArray(assets) || assets.length === 0)
    throw new TypeError('[Portfolio] assets must be non-empty array');

  const buyAssets  = assets.filter(a => a.signal === 'BUY');
  if (buyAssets.length === 0)
    return assets.map(a => ({ symbol: a.symbol, allocation: 0, allocPct: 0, weight: 0 }));

  const maxSingle  = RC.MAX_SINGLE_ASSET_PCT || 0.20;
  const deployable = totalCapital * (RC.MAX_PORTFOLIO_EXPOSURE || 0.95);

  let rawWeights = {};
  switch (method) {
    case 'vol_parity':     rawWeights = _volParityWeights(buyAssets);    break;
    case 'score_weighted': rawWeights = _scoreWeights(buyAssets);         break;
    default:               buyAssets.forEach(a => { rawWeights[a.symbol] = 1 / buyAssets.length; });
  }

  // Cap + redistribute excess
  let cappedWeights = { ...rawWeights };
  let excess = 0, uncapped = [];
  for (const [sym, w] of Object.entries(cappedWeights)) {
    if (w > maxSingle) { excess += w - maxSingle; cappedWeights[sym] = maxSingle; }
    else uncapped.push(sym);
  }
  if (excess > 0 && uncapped.length > 0) {
    const totalUncapped = uncapped.reduce((s, sym) => s + cappedWeights[sym], 0);
    for (const sym of uncapped) {
      cappedWeights[sym] += (cappedWeights[sym] / totalUncapped) * excess;
      cappedWeights[sym]  = Math.min(cappedWeights[sym], maxSingle);
    }
  }

  const weightSum = Object.values(cappedWeights).reduce((s, w) => s + w, 0);
  if (weightSum > 0)
    for (const sym of Object.keys(cappedWeights)) cappedWeights[sym] /= weightSum;

  return assets.map(a => {
    const w    = cappedWeights[a.symbol] || 0;
    const alloc = deployable * w;
    return {
      symbol:     a.symbol,
      allocation: parseFloat(alloc.toFixed(2)),
      allocPct:   parseFloat(w.toFixed(6)),
      weight:     parseFloat((rawWeights[a.symbol] || 0).toFixed(6)),
    };
  });
}

function _volParityWeights(assets) {
  const weights = {};
  const valid   = assets.filter(a => a.recentVol > 0);
  if (valid.length === 0) { assets.forEach(a => { weights[a.symbol] = 1 / assets.length; }); return weights; }
  const invSum  = valid.reduce((s, a) => s + 1 / a.recentVol, 0);
  valid.forEach(a => { weights[a.symbol] = (1 / a.recentVol) / invSum; });
  return weights;
}

function _scoreWeights(assets) {
  const weights  = {};
  const totalScore = assets.reduce((s, a) => s + Math.max(a.score || 0, 0.001), 0);
  assets.forEach(a => { weights[a.symbol] = Math.max(a.score || 0, 0.001) / totalScore; });
  return weights;
}

// ═══════════════════════════════════════════════════════════════════════════
// Portfolio State snapshot (preserved API)
// ═══════════════════════════════════════════════════════════════════════════

function computePortfolioState({ positions = [], cash = 0 }) {
  let marketValue = 0, costBasis = 0;
  const enriched = positions.map(p => {
    const mv  = p.currentPrice * p.quantity;
    const cb  = p.entryPrice   * p.quantity;
    const pnl = mv - cb;
    marketValue += mv; costBasis += cb;
    return { ...p, marketValue: parseFloat(mv.toFixed(2)), costBasis: parseFloat(cb.toFixed(2)),
             unrealisedPnL: parseFloat(pnl.toFixed(2)), pnlPct: parseFloat(((pnl/cb)*100).toFixed(4)) };
  });
  const totalValue    = marketValue + cash;
  const unrealisedPnL = marketValue - costBasis;
  return {
    totalValue:       parseFloat(totalValue.toFixed(2)),
    marketValue:      parseFloat(marketValue.toFixed(2)),
    cash:             parseFloat(cash.toFixed(2)),
    cashPct:          parseFloat((totalValue > 0 ? cash / totalValue : 1).toFixed(4)),
    deployedCapital:  parseFloat(marketValue.toFixed(2)),
    deployedPct:      parseFloat((totalValue > 0 ? marketValue / totalValue : 0).toFixed(4)),
    unrealisedPnL:    parseFloat(unrealisedPnL.toFixed(2)),
    unrealisedPnLPct: parseFloat((costBasis > 0 ? unrealisedPnL / costBasis * 100 : 0).toFixed(4)),
    positionCount:    positions.length, positions: enriched,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vol-scaled position sizing (preserved API)
// ═══════════════════════════════════════════════════════════════════════════

function volScaledSize({ capital, entryPrice, realisedVol, volTarget = (RC.VOL_TARGET_ANNUAL || 0.15) }) {
  if (capital <= 0 || entryPrice <= 0)
    throw new RangeError('[Portfolio] capital and entryPrice must be > 0');
  if (!realisedVol || realisedVol <= 0) { realisedVol = 0.20; }
  const maxPositionValue = capital * (RC.MAX_SINGLE_ASSET_PCT || 0.20);
  const targetValue      = (capital * volTarget) / realisedVol;
  const positionValue    = Math.min(targetValue, maxPositionValue);
  const quantity         = Math.max(0, Math.floor(positionValue / entryPrice));
  return {
    quantity,
    positionValue:   parseFloat(positionValue.toFixed(2)),
    volContribution: parseFloat((quantity * entryPrice * realisedVol / capital).toFixed(6)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Limit check (preserved API)
// ═══════════════════════════════════════════════════════════════════════════

function checkPortfolioLimits({ currentPositions, newSymbol, newValue, totalCapital }) {
  const warnings = [];
  if (currentPositions.length >= (PC.MAX_ASSETS || 10))
    warnings.push(`Max assets (${PC.MAX_ASSETS || 10}) already reached`);
  const allocPct = newValue / totalCapital;
  if (allocPct > (RC.MAX_SINGLE_ASSET_PCT || 0.20))
    warnings.push(`${newSymbol} allocation ${(allocPct*100).toFixed(1)}% exceeds max`);
  const curExp  = currentPositions.reduce((s, p) => s + p.currentPrice * p.quantity, 0);
  if ((curExp + newValue) / totalCapital > (RC.MAX_PORTFOLIO_EXPOSURE || 0.95))
    warnings.push(`Total exposure would exceed limit`);
  return { approved: warnings.length === 0, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO BACKTESTER — multi-asset historical simulation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a portfolio-level backtest across multiple symbols simultaneously.
 *
 * SIMULATION MODEL
 * ─────────────────
 * 1. Align all price series to a common calendar (union of all dates).
 * 2. On each bar date:
 *    a. For each open position: check stop-loss / take-profit / signal exits
 *    b. Generate signals for all symbols not currently held
 *    c. Rank signals, pick top N
 *    d. Allocate capital to selected signals
 *    e. Open positions that pass all risk filters
 *    f. Record bar-end MTM equity
 * 3. Force-close all positions at end of data.
 * 4. Compute portfolio-level performance metrics.
 *
 * NO LOOK-AHEAD: Signal generation uses only prices[0..i].
 * CAPITAL ACCOUNTING: Cash is always updated atomically.
 *
 * @param {{
 *   symbols:          string[],
 *   pricesMap:        Map<string, Array<{date,open,high,low,close}>>,
 *   initialCapital:   number,
 *   strategy:         string,
 *   allocMethod:      'equal'|'vol_parity'|'score_weighted',
 *   maxPositions:     number,
 *   maxSinglePct:     number,
 *   maxExposurePct:   number,
 *   maxDrawdownPct:   number,
 *   stopLossPct:      number,
 *   takeProfitPct:    number,
 *   minConfidence:    number,
 *   topN:             number,
 *   useRegime:        boolean,
 * }} config
 * @returns {{ summary, trades, equityCurve, perSymbolStats }}
 */
function runPortfolioBacktest(config) {
  const {
    symbols,
    pricesMap,
    initialCapital  = BT.DEFAULT_CAPITAL || 1_000_000,
    strategy        = 'AGGREGATED',
    allocMethod     = 'equal',
    maxPositions    = RC.MAX_OPEN_POSITIONS   || 5,
    maxSinglePct    = RC.MAX_SINGLE_ASSET_PCT || 0.20,
    maxExposurePct  = RC.MAX_PORTFOLIO_EXPOSURE || 0.95,
    maxDrawdownPct  = 0.15,
    stopLossPct     = RC.DEFAULT_STOP_LOSS_PCT   || 0.02,
    takeProfitPct   = RC.DEFAULT_TAKE_PROFIT_PCT || 0.04,
    minConfidence   = 0.30,
    topN            = maxPositions,
    useRegime       = true,
  } = config;

  if (!Array.isArray(symbols) || symbols.length === 0)
    throw new TypeError('[PortfolioBacktest] symbols must be non-empty array');
  if (!(pricesMap instanceof Map))
    throw new TypeError('[PortfolioBacktest] pricesMap must be a Map<symbol, bars[]>');

  const stratKey = strategy.toUpperCase();
  if (!strategies[stratKey])
    throw new Error(`[PortfolioBacktest] Unknown strategy: ${strategy}`);

  logger.info(
    `[PortfolioBT] START | symbols=${symbols.length} | capital=₹${initialCapital.toLocaleString()} | ` +
    `strategy=${stratKey} | alloc=${allocMethod} | maxPos=${maxPositions}`
  );

  // ── Build unified date index ──────────────────────────────────────────────
  // All unique dates across all symbols, sorted ascending
  const allDates = [...new Set(
    symbols.flatMap(sym => (pricesMap.get(sym) || []).map(b => b.date))
  )].sort();

  if (allDates.length < 201) {
    throw new RangeError(
      `[PortfolioBacktest] Need ≥201 unique dates, got ${allDates.length}`
    );
  }

  // Build per-symbol price index: symbol → Map<date, bar>
  const priceIndex = new Map();
  const closesIndex = new Map(); // symbol → closes array up to each date (built incrementally)

  for (const sym of symbols) {
    const bars = pricesMap.get(sym) || [];
    const byDate = new Map();
    for (const b of bars) byDate.set(b.date, b);
    priceIndex.set(sym, byDate);
    closesIndex.set(sym, []);
  }

  // ── Initialise portfolio state ────────────────────────────────────────────
  const portfolio = new PortfolioState({
    initialCapital, maxPositions, maxDrawdownPct,
    maxSinglePct, maxExposurePct,
  });

  const REGIME_CHECK_EVERY = 10;
  let barIdx = 0;

  // ── Main simulation loop ──────────────────────────────────────────────────
  for (const date of allDates) {
    barIdx++;

    // Build current price map and extend closes arrays
    const currentPrices = new Map();
    for (const sym of symbols) {
      const bar = priceIndex.get(sym)?.get(date);
      if (bar) {
        currentPrices.set(sym, bar.close);
        closesIndex.get(sym).push(bar.close);
      }
    }

    // Skip until we have enough warmup data (201 bars min for indicators)
    if (barIdx < 201) {
      portfolio.recordBarEnd(currentPrices);
      continue;
    }

    // ── Step 1: Process exits on open positions ───────────────────────────
    for (const [sym, pos] of [...portfolio.positions]) {
      const bar = priceIndex.get(sym)?.get(date);
      if (!bar) continue;

      let exitPrice = null;
      let exitReason = null;

      // Stop-loss: triggered if bar.low ≤ stopLoss
      if (isFinite(bar.low) && bar.low <= pos.stopLoss) {
        exitPrice  = pos.stopLoss;
        exitReason = 'STOP_LOSS';
      }
      // Take-profit: triggered if bar.high ≥ takeProfit
      else if (isFinite(bar.high) && bar.high >= pos.takeProfit) {
        exitPrice  = pos.takeProfit;
        exitReason = 'TAKE_PROFIT';
      }
      // Signal-based exit
      else {
        const closes = closesIndex.get(sym);
        const sig    = _getSignal(closes, stratKey);
        if (sig.signal === 'SELL' && sig.confidence >= minConfidence) {
          exitPrice  = bar.close;
          exitReason = 'SIGNAL';
        }
      }

      if (exitPrice != null) {
        const realisedVol = mu.annualisedVol(closesIndex.get(sym).slice(-21));
        const slipResult  = txCosts.applySlippage({ side: 'SELL', marketPrice: exitPrice, realisedVol });
        const fillPrice   = slipResult.fillPrice;
        const tx          = txCosts.computeCosts({ side: 'SELL', price: fillPrice, quantity: pos.qty });

        portfolio.closePosition({
          symbol: sym, exitPrice: fillPrice, exitDate: date,
          exitReason, exitCost: tx.totalCost, exitSlippage: slipResult.slippageCost,
        });
      }
    }

    // ── Step 2: Check circuit breaker ─────────────────────────────────────
    const { circuitBreaker } = portfolio.recordBarEnd(currentPrices);
    if (circuitBreaker) {
      logger.warn(`[PortfolioBT] Circuit breaker at ${date} — no new entries`);
      continue;
    }

    // ── Step 3: Generate signals for non-held symbols ─────────────────────
    const signalCandidates = [];
    for (const sym of symbols) {
      if (portfolio.positions.has(sym)) continue;
      const closes = closesIndex.get(sym);
      if (!closes || closes.length < 201) continue;

      const sig        = _getSignal(closes, stratKey, useRegime && barIdx % REGIME_CHECK_EVERY === 0 ? sym : null);
      const recentVol  = mu.annualisedVol(closes.slice(-21));
      signalCandidates.push({ symbol: sym, ...sig, recentVol: recentVol || 0.20 });
    }

    // ── Step 4: Rank and select top N signals ─────────────────────────────
    const topSignals = rankSignals(signalCandidates, { topN, minConfidence });
    if (topSignals.length === 0) continue;

    // ── Step 5: Allocate capital to selected signals ──────────────────────
    const totalEquity = portfolio.totalEquity(currentPrices);
    const allocations = allocateCapital({
      totalCapital: totalEquity,
      assets:       topSignals.map(s => ({ ...s, score: s.score })),
      method:       allocMethod,
    });

    // ── Step 6: Open positions ────────────────────────────────────────────
    for (const alloc of allocations) {
      if (alloc.allocation <= 0) continue;
      const sym = alloc.symbol;
      const bar = priceIndex.get(sym)?.get(date);
      if (!bar) continue;

      const realisedVol  = mu.annualisedVol(closesIndex.get(sym).slice(-21));
      const slipResult   = txCosts.applySlippage({ side: 'BUY', marketPrice: bar.close, realisedVol });
      const entryFill    = slipResult.fillPrice;

      // Compute quantity from allocated capital
      let qty = Math.floor(alloc.allocation / entryFill);
      if (qty <= 0) continue;

      const tx         = txCosts.computeCosts({ side: 'BUY', price: entryFill, quantity: qty });
      const totalEntry = qty * entryFill + tx.totalCost;

      const riskCheck = portfolio.canEnter({ symbol: sym, positionValue: totalEntry, currentPrices });
      if (!riskCheck.approved) {
        logger.debug(`[PortfolioBT] ${sym} rejected: ${riskCheck.reasons.join('; ')}`);
        continue;
      }

      portfolio.openPosition({
        symbol:       sym,
        qty,
        entryPrice:   parseFloat(entryFill.toFixed(4)),
        entryDate:    date,
        stopLoss:     parseFloat((entryFill * (1 - stopLossPct)).toFixed(4)),
        takeProfit:   parseFloat((entryFill * (1 + takeProfitPct)).toFixed(4)),
        entryCost:    parseFloat(tx.totalCost.toFixed(4)),
        entrySlippage:slipResult.slippageCost,
      });
    }
  }

  // ── Force-close all open positions at end ────────────────────────────────
  const lastDate      = allDates[allDates.length - 1];
  const lastPrices    = new Map();
  for (const sym of symbols) {
    const closes = closesIndex.get(sym);
    if (closes && closes.length > 0) lastPrices.set(sym, closes[closes.length - 1]);
  }

  for (const [sym, pos] of [...portfolio.positions]) {
    const lastClose  = lastPrices.get(sym) ?? pos.entryPrice;
    const slipResult = txCosts.applySlippage({ side: 'SELL', marketPrice: lastClose });
    const fillPrice  = slipResult.fillPrice;
    const tx         = txCosts.computeCosts({ side: 'SELL', price: fillPrice, quantity: pos.qty });
    portfolio.closePosition({
      symbol: sym, exitPrice: fillPrice, exitDate: lastDate,
      exitReason: 'END_OF_DATA', exitCost: tx.totalCost, exitSlippage: slipResult.slippageCost,
    });
  }

  // ── Compute portfolio-level metrics ──────────────────────────────────────
  const finalEquity = portfolio.cash;
  const summary     = _computePortfolioMetrics({
    symbols, initialCapital, finalCapital: finalEquity,
    trades: portfolio.trades, equityCurve: portfolio.equityCurve,
    dailyReturns: portfolio.dailyReturns,
    startDate: allDates[200], endDate: lastDate,
    allocMethod, strategy: stratKey,
  });

  // Per-symbol stats
  const perSymbolStats = _computePerSymbolStats(portfolio.trades, symbols);

  logger.info(
    `[PortfolioBT] DONE | return=${summary.totalReturnPct.toFixed(2)}% | ` +
    `sharpe=${summary.sharpeRatio?.toFixed(3) ?? 'N/A'} | ` +
    `trades=${summary.totalTrades} | symbols=${symbols.length}`
  );

  return {
    summary,
    trades:        portfolio.trades,
    equityCurve:   portfolio.equityCurve,
    perSymbolStats,
  };
}

// ── Signal dispatch (same logic as single-asset backtester) ──────────────────

function _getSignal(closes, stratKey, symbol = null) {
  switch (stratKey) {
    case 'MEAN_REVERSION': return strategies.MEAN_REVERSION.generateSignal(closes);
    case 'MA_CROSSOVER':   return strategies.MA_CROSSOVER.generateSignal(closes);
    case 'RSI':            return strategies.RSI.generateSignal(closes);
    case 'AGGREGATED':
    default:
      return strategies.AGGREGATED.aggregate(closes, {
        symbol: symbol || '_portfolio',
        useRegime: symbol != null,
      });
  }
}

// ── Portfolio-level metrics ───────────────────────────────────────────────────

function _computePortfolioMetrics({
  symbols, initialCapital, finalCapital, trades, equityCurve,
  dailyReturns, startDate, endDate, allocMethod, strategy,
}) {
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;

  const daysDiff = Math.max(1, (new Date(endDate) - new Date(startDate)) / 86400000);
  const years    = daysDiff / 365;
  const cagr     = (Math.pow(Math.max(finalCapital, 0.01) / initialCapital, 1 / years) - 1) * 100;

  const sharpe  = mu.sharpeRatio(dailyReturns, (BT.RISK_FREE_RATE || 0.065), (BT.TRADING_DAYS_PER_YEAR || 252));
  const sortino = mu.sortinoRatio(dailyReturns, (BT.RISK_FREE_RATE || 0.065), (BT.TRADING_DAYS_PER_YEAR || 252));
  const { maxDrawdown } = mu.maxDrawdown(equityCurve);
  const calmar  = maxDrawdown > 0 ? parseFloat((cagr / (maxDrawdown * 100)).toFixed(4)) : null;

  const totalTxCosts = trades.reduce((s, t) => s + (t.totalCost || 0), 0);
  const avgWinPct    = wins.length   ? wins.reduce((s, t)   => s + t.pnlPct, 0) / wins.length   : 0;
  const avgLossPct   = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

  return {
    symbols, strategy, allocMethod, startDate, endDate,
    initialCapital:        parseFloat(initialCapital.toFixed(2)),
    finalCapital:          parseFloat(finalCapital.toFixed(2)),
    totalReturnPct:        parseFloat(totalReturn.toFixed(4)),
    annualisedReturnPct:   parseFloat(cagr.toFixed(4)),
    sharpeRatio:           sharpe  != null ? parseFloat(sharpe.toFixed(4))  : null,
    sortinoRatio:          sortino != null ? parseFloat(sortino.toFixed(4)) : null,
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
    totalTransactionCosts: parseFloat(totalTxCosts.toFixed(2)),
    costDragPct:           parseFloat((totalTxCosts / initialCapital * 100).toFixed(4)),
  };
}

function _computePerSymbolStats(trades, symbols) {
  const stats = {};
  for (const sym of symbols) {
    const symTrades = trades.filter(t => t.symbol === sym);
    const wins      = symTrades.filter(t => t.pnl > 0);
    stats[sym] = {
      trades:      symTrades.length,
      wins:        wins.length,
      losses:      symTrades.length - wins.length,
      winRate:     symTrades.length ? parseFloat((wins.length / symTrades.length * 100).toFixed(2)) : 0,
      totalPnL:    parseFloat(symTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2)),
      avgPnLPct:   symTrades.length ? parseFloat((symTrades.reduce((s, t) => s + t.pnlPct, 0) / symTrades.length).toFixed(4)) : 0,
    };
  }
  return stats;
}

module.exports = {
  // NEW — portfolio-level simulation
  PortfolioState,
  runPortfolioBacktest,
  rankSignals,
  // Preserved API
  allocateCapital,
  computePortfolioState,
  volScaledSize,
  checkPortfolioLimits,
};
