// src/engine/portfolioEngine.js — v2: Realistic Capital Allocation & Trade Selection
// ─────────────────────────────────────────────────────────────────────────────
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT'S NEW IN V2 vs V1
// ═══════════════════════════════════════════════════════════════════════════
//
// PROBLEM 1 — Over-allocation
//   V1 computed weights on TOTAL capital, then allocated, ignoring that some
//   capital is already locked in open positions. On a 5-symbol portfolio with
//   3 open positions, it might try to allocate 95% of total capital again
//   to the 2 new entries — creating impossible orders.
//
//   FIX: allocateCapital() now requires `availableCapital` (free cash).
//   Allocation happens against cash-on-hand, not gross portfolio value.
//
// PROBLEM 2 — Weak signal selection
//   V1's rankSignals() used only confidence score. This ignores:
//     • How volatile the asset is (high vol = risky, penalise)
//     • Recent momentum (prefer entries with the trend, not against it)
//
//   FIX: Composite ranking score:
//     score = 0.4 × signalConfidence + 0.3 × volatilityScore + 0.3 × momentumScore
//
//   Components:
//     signalConfidence: strategy aggregator output confidence [0,1]
//     volatilityScore:  normalised INVERSE vol — lower vol = higher score
//                       (we want lower-vol assets, they're easier to size)
//     momentumScore:    normalised recent price momentum (ROC over 20 bars)
//                       aligned with signal direction
//
// PROBLEM 3 — No exposure control
//   V1 let individual assets grow to 20% per position, but didn't track
//   the TOTAL deployed capital dynamically.
//
//   FIX: PortfolioRiskMonitor class tracks live exposure, utilisation,
//   drawdown, and per-asset concentration continuously.
//
// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION POINTS
// ═══════════════════════════════════════════════════════════════════════════
//
//   BACKTEST:
//     Use rankSignals() to select top-N BUY candidates per bar.
//     Use allocateCapital({ availableCapital: cash }) for correct sizing.
//     Use PortfolioRiskMonitor.snapshot() for equity curve and metrics.
//
//   LIVE ENGINE (liveSignalEngine.js):
//     const ranked = rankSignals(liveResults, { topN: 3 });
//     const allocs = allocateCapital({ availableCapital: engine.freeCash, assets: ranked });
//
// ═══════════════════════════════════════════════════════════════════════════
// PRESERVED API (zero breaking changes)
// ═══════════════════════════════════════════════════════════════════════════
//   allocateCapital({ totalCapital, assets, method })   — original sig preserved
//   computePortfolioState({ positions, cash })           — unchanged
//   volScaledSize({ capital, entryPrice, realisedVol }) — unchanged
//   checkPortfolioLimits({ ... })                        — unchanged
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const mu     = require('../utils/mathUtils');
const C      = require('../config/constants');
const logger = require('../config/logger');

const PC = C.PORTFOLIO || {};
const RC = C.RISK      || {};

// ── Defaults (safe fallbacks if constants not fully populated) ────────────────
const MAX_ASSETS       = PC.MAX_ASSETS        || 10;
const ALLOC_METHOD     = PC.ALLOC_METHOD       || 'equal';
const MAX_EXPOSURE     = RC.MAX_PORTFOLIO_EXPOSURE || 0.95;
const MAX_SINGLE_PCT   = RC.MAX_SINGLE_ASSET_PCT   || 0.20;
const VOL_TARGET       = RC.VOL_TARGET_ANNUAL      || 0.15;

// ═══════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 2: Composite Signal Ranking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Composite ranking score (the formula you specified):
 *   score = 0.4 × signalConfidence + 0.3 × volatilityScore + 0.3 × momentumScore
 *
 * COMPONENT DEFINITIONS
 * ──────────────────────
 * signalConfidence  — strategy output confidence, already in [0,1]
 *
 * volatilityScore   — INVERSE normalised vol. Lower vol = safer to size = higher score.
 *   volScore = 1 - clamp(recentVol / VOL_CEILING, 0, 1)
 *   VOL_CEILING = 0.60 (60% annualised vol = worst case, score = 0)
 *   A 15%-vol asset scores 0.75; a 40%-vol asset scores 0.33.
 *
 * momentumScore     — recent price rate-of-change aligned with signal direction.
 *   roc = (price_now - price_N_ago) / price_N_ago  (N = 20 bars default)
 *   For BUY signals: positive roc is good (momentum supports entry)
 *   Normalised: clamp(roc / ROC_CEILING, 0, 1) where ROC_CEILING = 0.10 (10%)
 *   Negative roc on a BUY signal → score = 0 (momentum against us)
 *
 * @param {{
 *   confidence: number,       strategy confidence [0,1]
 *   recentVol:  number,       annualised realised vol (e.g. 0.20)
 *   momentum:   number|null,  recent ROC (e.g. 0.03 = +3%)
 *   signal:     'BUY'|'SELL'|'HOLD',
 * }} asset
 * @returns {number}  composite score in [0, 1]
 */
function computeCompositeScore(asset) {
  const { confidence = 0, recentVol = 0.20, momentum = 0, signal = 'HOLD' } = asset;

  const VOL_CEILING = 0.60;  // 60% annual vol → volatilityScore = 0
  const ROC_CEILING = 0.10;  // 10% ROC → momentumScore = 1

  // Component 1: signal confidence (direct)
  const confScore = mu.clamp(confidence, 0, 1);

  // Component 2: volatility score — INVERSE vol, normalised
  const volScore = mu.clamp(1 - (recentVol / VOL_CEILING), 0, 1);

  // Component 3: momentum — ROC aligned with signal direction
  // For BUY: positive momentum good. For SELL: negative momentum good.
  let momScore = 0;
  if (momentum != null && isFinite(momentum)) {
    const directedMomentum = signal === 'SELL' ? -momentum : momentum;
    momScore = mu.clamp(directedMomentum / ROC_CEILING, 0, 1);
  }

  const score = 0.4 * confScore + 0.3 * volScore + 0.3 * momScore;
  return parseFloat(mu.clamp(score, 0, 1).toFixed(6));
}

/**
 * Rank signals from N symbols and return top-K candidates.
 *
 * Differences from v1:
 *   • Uses compositeScore (confidence + vol + momentum) instead of raw confidence
 *   • Filters out symbols already held (avoids double-allocation)
 *   • Enforces topN cap (prevents overtrading)
 *   • Returns compositeScore, component scores, and ranking reason
 *
 * @param {Array<{
 *   symbol:     string,
 *   signal:     'BUY'|'SELL'|'HOLD',
 *   confidence: number,
 *   recentVol?: number,
 *   momentum?:  number,
 * }>} signals
 * @param {{
 *   topN:              number,    max positions to open (default 5)
 *   minScore:          number,    minimum composite score (default 0.30)
 *   minConfidence:     number,    minimum signal confidence (default 0.25)
 *   buyOnly:           boolean,   default true
 *   excludeSymbols:    string[],  symbols already held (skip to avoid double-alloc)
 * }} opts
 * @returns {Array}  sorted descending by compositeScore, length ≤ topN
 */
function rankSignals(signals, opts = {}) {
  const {
    topN           = 5,
    minScore       = 0.30,
    minConfidence  = 0.25,
    buyOnly        = true,
    excludeSymbols = [],
  } = opts;

  if (!Array.isArray(signals) || signals.length === 0) return [];

  const excluded = new Set(excludeSymbols.map(s => s.toUpperCase()));

  return signals
    // Step 1: Direction filter
    .filter(s => {
      if (buyOnly && s.signal !== 'BUY') return false;
      if ((s.confidence || 0) < minConfidence) return false;
      if (excluded.has((s.symbol || '').toUpperCase())) return false;
      return true;
    })
    // Step 2: Compute composite score
    .map(s => {
      const compositeScore = computeCompositeScore(s);
      const confScore  = mu.clamp(s.confidence || 0, 0, 1);
      const volScore   = mu.clamp(1 - ((s.recentVol || 0.20) / 0.60), 0, 1);
      const momScore   = s.momentum != null ? mu.clamp(s.momentum / 0.10, 0, 1) : 0;
      return {
        ...s,
        compositeScore,
        scoreBreakdown: {
          confidence: parseFloat((0.4 * confScore).toFixed(4)),
          volatility:  parseFloat((0.3 * volScore).toFixed(4)),
          momentum:    parseFloat((0.3 * momScore).toFixed(4)),
        },
      };
    })
    // Step 3: Filter by minimum composite score
    .filter(s => s.compositeScore >= minScore)
    // Step 4: Sort best first
    .sort((a, b) => b.compositeScore - a.compositeScore)
    // Step 5: Cap to topN
    .slice(0, topN);
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 1: Capital Allocation Fix
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Allocate AVAILABLE CASH across ranked signal candidates.
 *
 * KEY CHANGE from v1:
 *   • Now accepts `availableCapital` (free cash) separately from `totalCapital`
 *     (gross portfolio value). Allocation is against free cash, preventing
 *     double-allocation on already-held positions.
 *   • `totalCapital` is still used for per-asset concentration limits
 *     (e.g. "max 20% of total portfolio in one name").
 *
 * BACKWARD COMPATIBLE:
 *   If only `totalCapital` is provided (old call sites), availableCapital
 *   defaults to totalCapital — identical to v1 behaviour.
 *
 * @param {{
 *   totalCapital:     number,   total portfolio value (for concentration limits)
 *   availableCapital: number,   free cash to deploy (default = totalCapital)
 *   assets:           Array,    output of rankSignals()
 *   method:           'equal'|'vol_parity'|'score_weighted'|'composite',
 * }} params
 * @returns {Array<{ symbol, allocation, allocPct, weight, compositeScore }>}
 */
function allocateCapital({
  totalCapital,
  availableCapital,
  assets,
  method = ALLOC_METHOD,
}) {
  if (!totalCapital || totalCapital <= 0)
    throw new RangeError('[Portfolio] totalCapital must be > 0');
  if (!Array.isArray(assets) || assets.length === 0)
    throw new TypeError('[Portfolio] assets must be a non-empty array');

  // Default: available = total (backward compat)
  const freeCash = (availableCapital != null && availableCapital >= 0)
    ? availableCapital
    : totalCapital;

  if (freeCash <= 0) {
    logger.info('[Portfolio] No free cash available — zero allocations');
    return assets.map(a => ({ symbol: a.symbol, allocation: 0, allocPct: 0, weight: 0, compositeScore: a.compositeScore || 0 }));
  }

  // Only BUY-signal assets get allocated
  const buyAssets = assets.filter(a => a.signal === 'BUY' || !a.signal);
  if (buyAssets.length === 0) {
    return assets.map(a => ({ symbol: a.symbol, allocation: 0, allocPct: 0, weight: 0, compositeScore: a.compositeScore || 0 }));
  }

  // Total deployable = min(freeCash × maxExposure, freeCash)
  // We don't want to deploy more than MAX_EXPOSURE of available cash
  const deployable = freeCash * MAX_EXPOSURE;

  // ── Compute raw weights per method ───────────────────────────────────────
  let rawWeights = {};

  switch (method) {
    case 'vol_parity':
      rawWeights = _volParityWeights(buyAssets);
      break;

    case 'score_weighted':
      rawWeights = _scoreWeights(buyAssets);
      break;

    case 'composite':
      // NEW: use compositeScore (includes vol + momentum) instead of raw confidence
      rawWeights = _compositeWeights(buyAssets);
      break;

    case 'equal':
    default:
      buyAssets.forEach(a => { rawWeights[a.symbol] = 1 / buyAssets.length; });
  }

  // ── Apply per-asset concentration cap ────────────────────────────────────
  // Cap is based on TOTAL portfolio value (not just available cash),
  // so a new position can't exceed e.g. 20% of total portfolio
  const maxAllocForSingleAsset = totalCapital * MAX_SINGLE_PCT;
  let cappedWeights = { ...rawWeights };
  let excess = 0, uncapped = [];

  for (const [sym, w] of Object.entries(cappedWeights)) {
    const allocIfFull = deployable * w;
    if (allocIfFull > maxAllocForSingleAsset) {
      const cappedW = maxAllocForSingleAsset / deployable;
      excess += w - cappedW;
      cappedWeights[sym] = cappedW;
    } else {
      uncapped.push(sym);
    }
  }

  // Redistribute excess proportionally to uncapped assets
  if (excess > 0 && uncapped.length > 0) {
    const totalUncapped = uncapped.reduce((s, sym) => s + cappedWeights[sym], 0);
    for (const sym of uncapped) {
      const newW = cappedWeights[sym] + (cappedWeights[sym] / totalUncapped) * excess;
      const cap  = maxAllocForSingleAsset / deployable;
      cappedWeights[sym] = Math.min(newW, cap);
    }
  }

  // Normalise so weights sum to 1
  const wSum = Object.values(cappedWeights).reduce((s, w) => s + w, 0);
  if (wSum > 0)
    for (const sym of Object.keys(cappedWeights)) cappedWeights[sym] /= wSum;

  // ── Build result for all input assets ────────────────────────────────────
  const result = assets.map(a => {
    const w    = cappedWeights[a.symbol] || 0;
    const alloc = deployable * w;
    return {
      symbol:         a.symbol,
      allocation:     parseFloat(alloc.toFixed(2)),
      allocPct:       parseFloat(w.toFixed(6)),
      allocPctOfTotal:parseFloat((alloc / totalCapital).toFixed(6)),
      weight:         parseFloat((rawWeights[a.symbol] || 0).toFixed(6)),
      compositeScore: parseFloat((a.compositeScore || 0).toFixed(6)),
    };
  });

  logger.info(
    `[Portfolio] Allocated ₹${deployable.toFixed(0)} (of ₹${freeCash.toFixed(0)} free) ` +
    `across ${buyAssets.length} assets (${method}): ` +
    result.filter(r => r.allocation > 0)
          .map(r => `${r.symbol}=${(r.allocPctOfTotal * 100).toFixed(1)}%`)
          .join(', ')
  );

  return result;
}

// Weight helpers

function _volParityWeights(assets) {
  const weights = {};
  const valid   = assets.filter(a => a.recentVol > 0);
  if (valid.length === 0) {
    assets.forEach(a => { weights[a.symbol] = 1 / assets.length; });
    return weights;
  }
  const invSum = valid.reduce((s, a) => s + 1 / a.recentVol, 0);
  valid.forEach(a => { weights[a.symbol] = (1 / a.recentVol) / invSum; });
  const missing = assets.filter(a => !a.recentVol || a.recentVol <= 0);
  if (missing.length > 0) {
    const missingShare = (1 / assets.length) * missing.length;
    const scale        = 1 - missingShare;
    for (const s of Object.keys(weights)) weights[s] *= scale;
    missing.forEach(a => { weights[a.symbol] = 1 / assets.length; });
  }
  return weights;
}

function _scoreWeights(assets) {
  const weights    = {};
  const totalScore = assets.reduce((s, a) => s + Math.max(a.score || a.confidence || 0, 0.001), 0);
  assets.forEach(a => { weights[a.symbol] = Math.max(a.score || a.confidence || 0, 0.001) / totalScore; });
  return weights;
}

function _compositeWeights(assets) {
  const weights      = {};
  const totalComposite = assets.reduce((s, a) => s + Math.max(a.compositeScore || 0, 0.001), 0);
  assets.forEach(a => { weights[a.symbol] = Math.max(a.compositeScore || 0, 0.001) / totalComposite; });
  return weights;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 5: Portfolio Risk Metrics — Live Monitor
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PortfolioRiskMonitor — tracks exposure, drawdown, utilisation, and
 * concentration continuously. Designed for both backtests and live engines.
 *
 * Usage (backtest):
 *   const monitor = new PortfolioRiskMonitor(1_000_000);
 *   // On each bar:
 *   monitor.update(openPositions, cash, currentPrices);
 *   const metrics = monitor.snapshot();
 *   const ok = monitor.canOpenPosition(symbol, positionValue);
 *
 * Usage (live):
 *   const monitor = new PortfolioRiskMonitor(capital, { maxPositions: 3 });
 *   // On each signal tick:
 *   const { approved, reasons } = monitor.canOpenPosition(symbol, tradeValue);
 */
class PortfolioRiskMonitor {
  /**
   * @param {number} initialCapital
   * @param {{
   *   maxPositions?:  number,
   *   maxSinglePct?:  number,
   *   maxExposurePct?:number,
   *   maxDrawdownPct?:number,   circuit breaker threshold
   * }} opts
   */
  constructor(initialCapital, opts = {}) {
    if (!initialCapital || initialCapital <= 0)
      throw new RangeError('[RiskMonitor] initialCapital must be > 0');

    this.initialCapital  = initialCapital;
    this.maxPositions    = opts.maxPositions    || MAX_ASSETS;
    this.maxSinglePct    = opts.maxSinglePct    || MAX_SINGLE_PCT;
    this.maxExposurePct  = opts.maxExposurePct  || MAX_EXPOSURE;
    this.maxDrawdownPct  = opts.maxDrawdownPct  || 0.20;  // 20% drawdown = circuit breaker

    // Equity tracking
    this.peakEquity      = initialCapital;
    this.equityCurve     = [initialCapital];
    this.dailyReturns    = [];
    this._lastEquity     = initialCapital;

    // Current state
    this._positions      = new Map();  // symbol → { qty, entryPrice, marketValue }
    this._cash           = initialCapital;
    this._totalExposure  = 0;
    this._openCount      = 0;
  }

  /**
   * Update monitor state. Call once per bar after resolving exits/entries.
   * @param {Map<string,{qty,entryPrice}>|Object} positions  open positions
   * @param {number} cash  free cash
   * @param {Map<string,number>|Object} currentPrices  symbol → current price
   */
  update(positions, cash, currentPrices) {
    // Normalise positions to Map
    const posMap  = positions instanceof Map ? positions : new Map(Object.entries(positions));
    const priceMap = currentPrices instanceof Map ? currentPrices : new Map(Object.entries(currentPrices));

    this._cash      = cash;
    this._positions = posMap;
    this._openCount = posMap.size;

    // Compute market value and exposure
    let marketValue = 0;
    for (const [sym, pos] of posMap) {
      const price = priceMap.get(sym) ?? pos.entryPrice;
      const mv    = pos.qty * price;
      marketValue += mv;
    }
    this._totalExposure = marketValue;

    // Track equity curve
    const equity = cash + marketValue;
    this.equityCurve.push(equity);

    if (this.equityCurve.length >= 2) {
      const prev = this.equityCurve[this.equityCurve.length - 2];
      this.dailyReturns.push(prev > 0 ? (equity - prev) / prev : 0);
    }

    if (equity > this.peakEquity) this.peakEquity = equity;
    this._lastEquity = equity;
  }

  /**
   * Check whether opening a new position is allowed.
   * @param {string} symbol
   * @param {number} positionValue  ₹ value of proposed position
   * @returns {{ approved: boolean, reasons: string[] }}
   */
  canOpenPosition(symbol, positionValue) {
    const reasons = [];
    const equity  = this._lastEquity;

    if (this._positions.has(symbol))
      reasons.push(`Already holding ${symbol} — no pyramiding`);

    if (this._openCount >= this.maxPositions)
      reasons.push(`Max positions (${this.maxPositions}) reached`);

    if (positionValue > this._cash)
      reasons.push(`Insufficient cash: need ₹${positionValue.toFixed(0)}, have ₹${this._cash.toFixed(0)}`);

    const singlePct = equity > 0 ? positionValue / equity : 0;
    if (singlePct > this.maxSinglePct)
      reasons.push(`Position ${(singlePct * 100).toFixed(1)}% exceeds max ${(this.maxSinglePct * 100).toFixed(0)}%`);

    const newExposurePct = equity > 0 ? (this._totalExposure + positionValue) / equity : 0;
    if (newExposurePct > this.maxExposurePct)
      reasons.push(`Total exposure ${(newExposurePct * 100).toFixed(1)}% would exceed ${(this.maxExposurePct * 100).toFixed(0)}%`);

    // Circuit breaker
    const drawdown = this.currentDrawdown();
    if (drawdown >= this.maxDrawdownPct)
      reasons.push(`Drawdown ${(drawdown * 100).toFixed(1)}% ≥ circuit breaker ${(this.maxDrawdownPct * 100).toFixed(0)}%`);

    return { approved: reasons.length === 0, reasons };
  }

  /** Current drawdown from peak. */
  currentDrawdown() {
    return this.peakEquity > 0
      ? Math.max(0, (this.peakEquity - this._lastEquity) / this.peakEquity)
      : 0;
  }

  /**
   * Comprehensive portfolio risk snapshot.
   * @returns {{
   *   totalEquity, cash, totalExposure, deployedPct, cashPct,
   *   openPositions, currentDrawdownPct, maxDrawdownPct,
   *   capitalUtilisation, sharpeRatio, sortinoRatio,
   *   circuitBreakerActive, peakEquity
   * }}
   */
  snapshot() {
    const equity        = this._lastEquity;
    const deployedPct   = equity > 0 ? this._totalExposure / equity : 0;
    const cashPct       = equity > 0 ? this._cash / equity : 1;
    const drawdown      = this.currentDrawdown();
    const { maxDrawdown } = mu.maxDrawdown(this.equityCurve);
    const sharpe   = mu.sharpeRatio(this.dailyReturns, 0.065, 252);
    const sortino  = mu.sortinoRatio(this.dailyReturns, 0.065, 252);
    const utilisation  = this.initialCapital > 0
      ? this._totalExposure / this.initialCapital : 0;

    return {
      totalEquity:          parseFloat(equity.toFixed(2)),
      cash:                 parseFloat(this._cash.toFixed(2)),
      totalExposure:        parseFloat(this._totalExposure.toFixed(2)),
      deployedPct:          parseFloat((deployedPct * 100).toFixed(2)),
      cashPct:              parseFloat((cashPct * 100).toFixed(2)),
      openPositions:        this._openCount,
      currentDrawdownPct:   parseFloat((drawdown * 100).toFixed(4)),
      maxDrawdownPct:       parseFloat((maxDrawdown * 100).toFixed(4)),
      capitalUtilisation:   parseFloat((utilisation * 100).toFixed(2)),
      sharpeRatio:          sharpe  != null ? parseFloat(sharpe.toFixed(4))  : null,
      sortinoRatio:         sortino != null ? parseFloat(sortino.toFixed(4)) : null,
      circuitBreakerActive: drawdown >= this.maxDrawdownPct,
      peakEquity:           parseFloat(this.peakEquity.toFixed(2)),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESERVED v1 FUNCTIONS (unchanged — zero breaking changes)
// ═══════════════════════════════════════════════════════════════════════════

function computePortfolioState({ positions = [], cash = 0 }) {
  let marketValue = 0, costBasis = 0;
  const enriched = positions.map(p => {
    const mv  = p.currentPrice * p.quantity;
    const cb  = p.entryPrice   * p.quantity;
    const pnl = p.side === 'BUY' ? mv - cb : cb - mv;
    marketValue += mv; costBasis += cb;
    return { ...p,
      marketValue:   parseFloat(mv.toFixed(2)),
      costBasis:     parseFloat(cb.toFixed(2)),
      unrealisedPnL: parseFloat(pnl.toFixed(2)),
      pnlPct:        parseFloat(((pnl / cb) * 100).toFixed(4)),
    };
  });
  const totalValue = marketValue + cash;
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
    positionCount:    positions.length,
    positions:        enriched,
  };
}

function volScaledSize({ capital, entryPrice, realisedVol, volTarget = VOL_TARGET }) {
  if (capital <= 0 || entryPrice <= 0)
    throw new RangeError('[Portfolio] capital and entryPrice must be > 0');
  if (!realisedVol || realisedVol <= 0) { realisedVol = 0.20; }
  const maxPositionValue = capital * MAX_SINGLE_PCT;
  const targetValue      = (capital * volTarget) / realisedVol;
  const positionValue    = Math.min(targetValue, maxPositionValue);
  const quantity         = Math.max(0, Math.floor(positionValue / entryPrice));
  return {
    quantity,
    positionValue:   parseFloat(positionValue.toFixed(2)),
    volContribution: parseFloat((quantity * entryPrice * realisedVol / capital).toFixed(6)),
  };
}

function checkPortfolioLimits({ currentPositions, newSymbol, newValue, totalCapital }) {
  const warnings = [];
  if (currentPositions.length >= MAX_ASSETS)
    warnings.push(`Max assets (${MAX_ASSETS}) already reached`);
  const allocPct = newValue / totalCapital;
  if (allocPct > MAX_SINGLE_PCT)
    warnings.push(`${newSymbol} allocation ${(allocPct * 100).toFixed(1)}% exceeds max ${(MAX_SINGLE_PCT * 100).toFixed(0)}%`);
  const currentExposure = currentPositions.reduce((s, p) => s + p.currentPrice * p.quantity, 0);
  if ((currentExposure + newValue) / totalCapital > MAX_EXPOSURE)
    warnings.push(`Total exposure would exceed ${(MAX_EXPOSURE * 100).toFixed(0)}% limit`);
  return { approved: warnings.length === 0, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  // NEW exports (v2)
  computeCompositeScore,
  rankSignals,
  PortfolioRiskMonitor,
  // Updated (v2 with backward-compat)
  allocateCapital,
  // Preserved (v1 unchanged)
  computePortfolioState,
  volScaledSize,
  checkPortfolioLimits,
};
