// src/controllers/dataController.js
'use strict';

const nseFetcher = require('../data/nseFetcher');
const dataStore  = require('../data/dataStore');
const logger     = require('../config/logger');

/**
 * GET /api/data/quote/:symbol
 */
async function getQuote(req, res) {
  try {
    const { symbol } = req.params;
    const data = await nseFetcher.getQuote(symbol.toUpperCase());
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[DataCtrl] getQuote error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/historical/:symbol?from=DD-MM-YYYY&to=DD-MM-YYYY
 */
async function getHistorical(req, res) {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to query params required (DD-MM-YYYY)' });

    const data = await nseFetcher.getHistoricalData(symbol.toUpperCase(), from, to);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error(`[DataCtrl] getHistorical error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/data/fetch-and-store/:symbol
 * Body: { from: 'DD-MM-YYYY', to: 'DD-MM-YYYY' }
 */
async function fetchAndStore(req, res) {
  try {
    const { symbol } = req.params;
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to required in body' });

    const rows    = await nseFetcher.getHistoricalData(symbol.toUpperCase(), from, to);
    if (rows.length === 0) return res.json({ success: true, message: 'No data returned from NSE', saved: 0 });

    const saved = await dataStore.saveDailyPrices(rows);
    res.json({ success: true, fetched: rows.length, saved, symbol: symbol.toUpperCase() });
  } catch (err) {
    logger.error(`[DataCtrl] fetchAndStore error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/prices/:symbol?limit=200
 */
async function getPrices(req, res) {
  try {
    const { symbol } = req.params;
    const limit = parseInt(req.query.limit || '200', 10);
    const data  = await dataStore.getRecentPrices(symbol.toUpperCase(), limit);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error(`[DataCtrl] getPrices error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/nifty50
 */
async function getNifty50(req, res) {
  try {
    const data = await nseFetcher.getNifty50Quotes();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    logger.error(`[DataCtrl] getNifty50 error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/data/market-status
 */
async function getMarketStatus(req, res) {
  try {
    const data = await nseFetcher.getMarketStatus();
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[DataCtrl] getMarketStatus error: ${err.message}`);
    res.status(502).json({ success: false, error: err.message });
  }
}

module.exports = { getQuote, getHistorical, fetchAndStore, getPrices, getNifty50, getMarketStatus };
