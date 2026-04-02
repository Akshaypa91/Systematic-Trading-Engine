// src/controllers/screenerController.js
'use strict';

const screener = require('../screener/screener');
const C        = require('../config/constants');
const logger   = require('../config/logger');

/**
 * GET  /api/screener?topN=20&filter=BUY_CANDIDATES&symbols=RELIANCE,INFY,...
 * POST /api/screener  body: { symbols: [...], topN, filter, weights }
 */
async function runScreener(req, res) {
  try {
    // Merge params from body (POST) or query string (GET)
    const source = req.method === 'POST' ? req.body : req.query;

    const topN   = parseInt(source.topN   || '20', 10);
    const filter = (source.filter || 'ALL').toUpperCase();

    // Symbols: body array takes precedence, then comma-separated query string, then NIFTY50
    let universe;
    if (source.symbols && Array.isArray(source.symbols)) {
      universe = source.symbols.map(s => String(s).trim().toUpperCase());
    } else if (typeof source.symbols === 'string' && source.symbols.length > 0) {
      universe = source.symbols.split(',').map(s => s.trim().toUpperCase());
    } else {
      universe = C.NIFTY50_SYMBOLS;
    }

    // Weights: accept nested object (POST body) or individual query params (GET)
    const weights = source.weights && typeof source.weights === 'object'
      ? source.weights
      : {
          momentum:      parseFloat(source.wMomentum  || '0.40'),
          volatility:    parseFloat(source.wVolatility || '0.30'),
          meanReversion: parseFloat(source.wMR         || '0.30'),
        };

    const results = await screener.runScreener(universe, { topN, filter, weights });

    res.json({
      success:  true,
      universe: universe.length,
      returned: results.length,
      filter,
      data:     results,
    });
  } catch (err) {
    logger.error(`[ScreenerCtrl] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/screener/score/:symbol
 */
async function scoreSymbol(req, res) {
  try {
    const { symbol } = req.params;
    const result = await screener.scoreSymbol(symbol.toUpperCase(), 60);
    if (!result) return res.status(422).json({ success: false, error: `Insufficient data for ${symbol}` });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { runScreener, scoreSymbol };
