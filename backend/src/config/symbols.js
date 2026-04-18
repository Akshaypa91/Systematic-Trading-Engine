// src/config/symbols.js
// ─────────────────────────────────────────────────────────────────────────────
//
// UPSTOX INSTRUMENT KEY MAPPING
// ─────────────────────────────────────────────────────────────────────────────
//
// Upstox uses instrument keys in the format:
//   NSE_EQ|<ISIN>        — for equities  (NSE)
//   BSE_EQ|<ISIN>        — for equities  (BSE)
//   NSE_INDEX|Nifty 50   — for indices
//
// These are required for:
//   • REST API quote endpoint: GET /v2/market-quote/quotes?instrument_key=NSE_EQ|INE002A01018
//   • WebSocket subscription  { instrumentKeys: [...] }
//
// ISIN source: NSE's symbol master / Upstox instrument list CSV
// Last verified: April 2025
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Master instrument map ─────────────────────────────────────────────────────
// base symbol → { upstox: instrumentKey, isin, name }

const INSTRUMENT_MAP = {
  // ── Large Cap ────────────────────────────────────────────────────────────────
  RELIANCE:    { upstox: 'NSE_EQ|INE002A01018', isin: 'INE002A01018', name: 'Reliance Industries' },
  TCS:         { upstox: 'NSE_EQ|INE467B01029', isin: 'INE467B01029', name: 'Tata Consultancy Services' },
  HDFCBANK:    { upstox: 'NSE_EQ|INE040A01034', isin: 'INE040A01034', name: 'HDFC Bank' },
  INFY:        { upstox: 'NSE_EQ|INE009A01021', isin: 'INE009A01021', name: 'Infosys' },
  ICICIBANK:   { upstox: 'NSE_EQ|INE090A01021', isin: 'INE090A01021', name: 'ICICI Bank' },
  HINDUNILVR:  { upstox: 'NSE_EQ|INE030A01027', isin: 'INE030A01027', name: 'Hindustan Unilever' },
  BAJFINANCE:  { upstox: 'NSE_EQ|INE296A01024', isin: 'INE296A01024', name: 'Bajaj Finance' },
  SBIN:        { upstox: 'NSE_EQ|INE062A01020', isin: 'INE062A01020', name: 'State Bank of India' },
  BHARTIARTL:  { upstox: 'NSE_EQ|INE397D01024', isin: 'INE397D01024', name: 'Bharti Airtel' },
  KOTAKBANK:   { upstox: 'NSE_EQ|INE237A01028', isin: 'INE237A01028', name: 'Kotak Mahindra Bank' },
  LT:          { upstox: 'NSE_EQ|INE018A01030', isin: 'INE018A01030', name: 'Larsen & Toubro' },
  AXISBANK:    { upstox: 'NSE_EQ|INE238A01034', isin: 'INE238A01034', name: 'Axis Bank' },
  WIPRO:       { upstox: 'NSE_EQ|INE075A01022', isin: 'INE075A01022', name: 'Wipro' },
  ASIANPAINT:  { upstox: 'NSE_EQ|INE021A01026', isin: 'INE021A01026', name: 'Asian Paints' },
  MARUTI:      { upstox: 'NSE_EQ|INE585B01010', isin: 'INE585B01010', name: 'Maruti Suzuki' },
  TITAN:       { upstox: 'NSE_EQ|INE280A01028', isin: 'INE280A01028', name: 'Titan Company' },
  TECHM:       { upstox: 'NSE_EQ|INE669C01036', isin: 'INE669C01036', name: 'Tech Mahindra' },
  SUNPHARMA:   { upstox: 'NSE_EQ|INE044A01036', isin: 'INE044A01036', name: 'Sun Pharmaceutical' },
  ULTRACEMCO:  { upstox: 'NSE_EQ|INE481G01011', isin: 'INE481G01011', name: 'UltraTech Cement' },
  HCLTECH:     { upstox: 'NSE_EQ|INE860A01027', isin: 'INE860A01027', name: 'HCL Technologies' },

  // ── Mid/Large Cap ─────────────────────────────────────────────────────────
  ITC:         { upstox: 'NSE_EQ|INE154A01025', isin: 'INE154A01025', name: 'ITC' },
  INDUSINDBK:  { upstox: 'NSE_EQ|INE095A01012', isin: 'INE095A01012', name: 'IndusInd Bank' },
  ONGC:        { upstox: 'NSE_EQ|INE213A01029', isin: 'INE213A01029', name: 'ONGC' },
  NTPC:        { upstox: 'NSE_EQ|INE733E01010', isin: 'INE733E01010', name: 'NTPC' },
  TATAMOTORS:  { upstox: 'NSE_EQ|INE155A01022', isin: 'INE155A01022', name: 'Tata Motors' },
  TATASTEEL:   { upstox: 'NSE_EQ|INE081A01020', isin: 'INE081A01020', name: 'Tata Steel' },
  TATACONSUM:  { upstox: 'NSE_EQ|INE192A01025', isin: 'INE192A01025', name: 'Tata Consumer Products' },
  POWERGRID:   { upstox: 'NSE_EQ|INE752E01010', isin: 'INE752E01010', name: 'Power Grid Corp' },
  HDFCLIFE:    { upstox: 'NSE_EQ|INE795G01014', isin: 'INE795G01014', name: 'HDFC Life Insurance' },
  SBILIFE:     { upstox: 'NSE_EQ|INE123W01016', isin: 'INE123W01016', name: 'SBI Life Insurance' },
  ADANIENT:    { upstox: 'NSE_EQ|INE423A01024', isin: 'INE423A01024', name: 'Adani Enterprises' },
  ADANIPORTS:  { upstox: 'NSE_EQ|INE742F01042', isin: 'INE742F01042', name: 'Adani Ports' },
  BAJAJFINSV:  { upstox: 'NSE_EQ|INE918I01026', isin: 'INE918I01026', name: 'Bajaj Finserv' },
  JSWSTEEL:    { upstox: 'NSE_EQ|INE019A01038', isin: 'INE019A01038', name: 'JSW Steel' },
  HINDALCO:    { upstox: 'NSE_EQ|INE038A01020', isin: 'INE038A01020', name: 'Hindalco Industries' },
  NESTLEIND:   { upstox: 'NSE_EQ|INE239N01024', isin: 'INE239N01024', name: 'Nestle India' },
  GRASIM:      { upstox: 'NSE_EQ|INE047A01021', isin: 'INE047A01021', name: 'Grasim Industries' },
  BPCL:        { upstox: 'NSE_EQ|INE029A01011', isin: 'INE029A01011', name: 'BPCL' },
  COALINDIA:   { upstox: 'NSE_EQ|INE522F01014', isin: 'INE522F01014', name: 'Coal India' },
  CIPLA:       { upstox: 'NSE_EQ|INE059A01026', isin: 'INE059A01026', name: 'Cipla' },
  DRREDDY:     { upstox: 'NSE_EQ|INE089A01031', isin: 'INE089A01031', name: "Dr. Reddy's" },
  BRITANNIA:   { upstox: 'NSE_EQ|INE216A01030', isin: 'INE216A01030', name: 'Britannia Industries' },
  DIVISLAB:    { upstox: 'NSE_EQ|INE361B01024', isin: 'INE361B01024', name: "Divi's Laboratories" },
  HEROMOTOCO:  { upstox: 'NSE_EQ|INE158A01026', isin: 'INE158A01026', name: 'Hero MotoCorp' },
  APOLLOHOSP:  { upstox: 'NSE_EQ|INE437A01024', isin: 'INE437A01024', name: 'Apollo Hospitals' },
  EICHERMOT:   { upstox: 'NSE_EQ|INE066A01021', isin: 'INE066A01021', name: 'Eicher Motors' },
  LTIM:        { upstox: 'NSE_EQ|INE214T01019', isin: 'INE214T01019', name: 'LTIMindtree' },
  UPL:         { upstox: 'NSE_EQ|INE628A01036', isin: 'INE628A01036', name: 'UPL' },
  'BAJAJ-AUTO': { upstox: 'NSE_EQ|INE917I01010', isin: 'INE917I01010', name: 'Bajaj Auto' },
  'M&M':        { upstox: 'NSE_EQ|INE101A01026', isin: 'INE101A01026', name: 'Mahindra & Mahindra' },

  // ── Indices ────────────────────────────────────────────────────────────────
  NIFTY:       { upstox: 'NSE_INDEX|Nifty 50',       isin: null, name: 'Nifty 50' },
  NIFTY50:     { upstox: 'NSE_INDEX|Nifty 50',       isin: null, name: 'Nifty 50' },
  BANKNIFTY:   { upstox: 'NSE_INDEX|Nifty Bank',     isin: null, name: 'Bank Nifty' },
  SENSEX:      { upstox: 'BSE_INDEX|SENSEX',         isin: null, name: 'BSE Sensex' },
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Get Upstox instrument key for a base symbol.
 * @param {string} symbol  e.g. 'TCS', 'M&M', 'RELIANCE'
 * @returns {string|null}  e.g. 'NSE_EQ|INE467B01029'
 */
function toUpstox(symbol) {
  if (!symbol) return null;
  const s = symbol.toString().trim().toUpperCase();
  return INSTRUMENT_MAP[s]?.upstox ?? null;
}

/**
 * Get base symbol from an Upstox instrument key.
 * Reverse lookup: 'NSE_EQ|INE467B01029' → 'TCS'
 * @param {string} instrumentKey
 * @returns {string|null}
 */
function fromUpstox(instrumentKey) {
  if (!instrumentKey) return null;
  for (const [sym, entry] of Object.entries(INSTRUMENT_MAP)) {
    if (entry.upstox === instrumentKey) return sym;
  }
  return null;
}

/**
 * Get all Upstox instrument keys for a list of base symbols.
 * Skips symbols without a mapping.
 * @param {string[]} symbols
 * @returns {string[]}
 */
function toUpstoxKeys(symbols) {
  return symbols
    .map(s => toUpstox(s))
    .filter(Boolean);
}

/**
 * Get all registered base symbols.
 * @returns {string[]}
 */
function allSymbols() {
  return Object.keys(INSTRUMENT_MAP);
}

/**
 * Get full entry for a symbol.
 * @param {string} symbol
 * @returns {{ upstox, isin, name }|null}
 */
function getEntry(symbol) {
  return INSTRUMENT_MAP[symbol?.toString().trim().toUpperCase()] ?? null;
}

module.exports = {
  INSTRUMENT_MAP,
  toUpstox,
  fromUpstox,
  toUpstoxKeys,
  allSymbols,
  getEntry,
};
