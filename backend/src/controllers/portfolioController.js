// src/controllers/portfolioController.js
// Portfolio-level backtest and state API
'use strict';

const dataStore = require('../data/dataStore');
const { runPortfolioBacktest, PortfolioState, rankSignals, allocateCapital } = require('../engine/portfolioEngine');
const aggregator = require('../strategies/aggregator');
const logger     = require('../config/logger');

// ── POST /api/portfolio/backtest ──────────────────────────────────────────────
// Body: {
//   symbols:       string[],          // e.g. ["RELIANCE","TCS","INFY"]
//   strategy:      string,            // default "AGGREGATED"
//   allocMethod:   string,            // "equal"|"vol_parity"|"score_weighted"
//   initialCapital:number,
//   startDate:     string,            // YYYY-MM-DD
//   endDate:       string,
//   maxPositions:  number,
//   maxSinglePct:  number,
//   stopLossPct:   number,
//   takeProfitPct: number,
//   topN:          number,
//   minConfidence: number,
// }
async function runBacktest(req, res) {
  try {
    const {
      symbols,
      strategy       = 'AGGREGATED',
      allocMethod    = 'equal',
      initialCapital = 1_000_000,
      startDate,
      endDate,
      maxPositions   = 5,
      maxSinglePct   = 0.20,
      maxExposurePct = 0.95,
      maxDrawdownPct = 0.15,
      stopLossPct    = 0.02,
      takeProfitPct  = 0.04,
      topN           = maxPositions,
      minConfidence  = 0.30,
      useRegime      = true,
    } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0)
      return res.status(400).json({ success: false, error: 'symbols must be a non-empty array' });
    if (symbols.length > 20)
      return res.status(400).json({ success: false, error: 'Max 20 symbols per portfolio backtest' });

    // Fetch price data for all symbols in parallel
    const pricesMap = new Map();
    const fetchErrors = [];

    await Promise.all(symbols.map(async (sym) => {
      try {
        const bars = await dataStore.getDailyPrices(sym.toUpperCase(), {
          startDate: startDate || null,
          endDate:   endDate   || null,
        });
        if (bars && bars.length >= 201) {
          pricesMap.set(sym.toUpperCase(), bars);
        } else {
          fetchErrors.push(`${sym}: insufficient data (${bars?.length ?? 0} bars)`);
        }
      } catch (e) {
        fetchErrors.push(`${sym}: ${e.message}`);
      }
    }));

    const validSymbols = [...pricesMap.keys()];
    if (validSymbols.length === 0) {
      return res.status(422).json({
        success: false,
        error:   'No symbols had sufficient data',
        details: fetchErrors,
      });
    }

    const result = runPortfolioBacktest({
      symbols:      validSymbols,
      pricesMap,
      initialCapital: parseFloat(initialCapital),
      strategy, allocMethod,
      maxPositions:   parseInt(maxPositions),
      maxSinglePct:   parseFloat(maxSinglePct),
      maxExposurePct: parseFloat(maxExposurePct),
      maxDrawdownPct: parseFloat(maxDrawdownPct),
      stopLossPct:    parseFloat(stopLossPct),
      takeProfitPct:  parseFloat(takeProfitPct),
      topN:           parseInt(topN),
      minConfidence:  parseFloat(minConfidence),
      useRegime:      useRegime !== false,
    });

    res.json({
      success: true,
      validSymbols,
      skipped: fetchErrors,
      summary: result.summary,
      perSymbolStats: result.perSymbolStats,
      trades: result.trades,
      equityCurveSample: result.equityCurve
        .filter((_, i) => i % 5 === 0)
        .map(v => parseFloat(v.toFixed(2))),
    });
  } catch (err) {
    logger.error(`[PortfolioCtrl] backtest: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/portfolio/signals ───────────────────────────────────────────────
// Get ranked signals for a list of symbols.
// Body: { symbols: string[], strategy?: string, topN?: number, minConfidence?: number }
async function getPortfolioSignals(req, res) {
  try {
    const {
      symbols,
      strategy      = 'AGGREGATED',
      topN          = 5,
      minConfidence = 0.25,
      lookback      = 250,
    } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0)
      return res.status(400).json({ success: false, error: 'symbols must be a non-empty array' });

    // Fetch signals for all symbols in parallel
    const signalResults = await Promise.all(
      symbols.map(async (sym) => {
        try {
          const bars = await dataStore.getRecentPrices(sym.toUpperCase(), lookback);
          if (!bars || bars.length < 20)
            return { symbol: sym.toUpperCase(), signal: 'HOLD', confidence: 0, error: 'insufficient data' };

          const closes = bars.map(b => b.close);
          let result;
          switch (strategy.toUpperCase()) {
            case 'MEAN_REVERSION': result = require('../strategies/meanReversion').generateSignal(closes); break;
            case 'MA_CROSSOVER':   result = require('../strategies/maCrossover').generateSignal(closes);   break;
            case 'RSI':            result = require('../strategies/rsiStrategy').generateSignal(closes);   break;
            default:               result = aggregator.aggregate(closes, { symbol: sym.toUpperCase() });   break;
          }
          const recentVol = require('../utils/mathUtils').annualisedVol(closes.slice(-21));
          return { symbol: sym.toUpperCase(), ...result, recentVol };
        } catch (e) {
          return { symbol: sym.toUpperCase(), signal: 'HOLD', confidence: 0, error: e.message };
        }
      })
    );

    const ranked = rankSignals(signalResults, { topN, minConfidence });

    res.json({
      success: true,
      total:   symbols.length,
      ranked:  ranked.length,
      signals: signalResults,
      topSignals: ranked,
    });
  } catch (err) {
    logger.error(`[PortfolioCtrl] signals: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/portfolio/allocate ──────────────────────────────────────────────
// Compute capital allocation for a given set of signals.
// Body: { totalCapital, assets: [{symbol, signal, score, recentVol}], method }
function computeAllocation(req, res) {
  try {
    const { totalCapital, assets, method = 'equal' } = req.body;
    if (!totalCapital || !Array.isArray(assets))
      return res.status(400).json({ success: false, error: 'totalCapital and assets required' });

    const result = allocateCapital({ totalCapital, assets, method });
    res.json({ success: true, method, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { runBacktest, getPortfolioSignals, computeAllocation };
