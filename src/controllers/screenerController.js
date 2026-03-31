// src/controllers/screenerController.js
'use strict';

const screener = require('../screener/screener');
const C        = require('../config/constants');
const logger   = require('../config/logger');

/**
 * GET /api/screener?topN=20&filter=BUY_CANDIDATES&symbols=RELIANCE,INFY,...
 */
async function runScreener(req, res) {
  try {
    const {
      topN   = 20,
      filter = 'ALL',
      symbols,
    } = req.query;

    const universe = symbols
      ? symbols.split(',').map(s => s.trim().toUpperCase())
      : C.NIFTY50_SYMBOLS;

    const weights = {
      momentum:      parseFloat(req.query.wMomentum  || '0.40'),
      volatility:    parseFloat(req.query.wVolatility || '0.30'),
      meanReversion: parseFloat(req.query.wMR         || '0.30'),
    };

    const results = await screener.runScreener(universe, {
      topN:    parseInt(topN, 10),
      filter:  filter.toUpperCase(),
      weights,
    });

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
