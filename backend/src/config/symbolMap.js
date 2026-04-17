// src/config/symbolMap.js
// ─────────────────────────────────────────────────────────────────────────────
//
// SYMBOL MAP — single source of truth for all exchange format differences
//
// WHY THIS EXISTS
// ───────────────
// Three systems use different symbol formats for the same stock:
//
//   TradingView  →  NSE:TCS          (exchange:symbol)
//   TwelveData   →  TCS:NSE          (symbol:exchange)  ← colon, reversed
//   Finnhub      →  NSE:TCS          (exchange:symbol, same as TV)
//
// Symbols with special characters also differ:
//   BAJAJ-AUTO   →  TwelveData: BAJAJ-AUTO:NSE  but TV: NSE:BAJAJ-AUTO ✓
//   M&M          →  TwelveData: MM:NSE (& stripped)
//   LTIM         →  TwelveData: LTIM:NSE, Finnhub: NSE:LTIM
//
// FORMAT RULES
// ────────────
//   tv:        "NSE:SYMBOL"  or  "BSE:SYMBOL"
//   twelve:    "SYMBOL:NSE"  (Twelve Data's own format)
//   finnhub:   "NSE:SYMBOL"  (Finnhub format, same as TV)
//   base:      plain symbol with no exchange  (used internally / DB keys)
//
// USAGE
// ─────
//   const { toTV, toTwelve, toFinnhub, fromAny } = require('./symbolMap');
//   toTV('TCS')         → 'NSE:TCS'
//   toTwelve('M&M')     → 'MM:NSE'
//   toFinnhub('BAJAJ-AUTO') → 'NSE:BAJAJ-AUTO'
//   fromAny('NSE:TCS')  → 'TCS'
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Master symbol registry ────────────────────────────────────────────────────
//
// Structure per entry:
//   base:    canonical internal key (matches DB, signals, portfolio)
//   tv:      TradingView widget symbol
//   twelve:  Twelve Data API symbol
//   finnhub: Finnhub API symbol
//   name:    human-readable company name
//
// Only symbols with non-standard formats need explicit entries.
// All other NIFTY50 symbols follow the default rules and are auto-generated.

const EXPLICIT_MAP = [
  // ── Special characters / non-obvious mappings ─────────────────────────────
  { base: 'M&M',       tv: 'NSE:MM',        twelve: 'MM:NSE',        finnhub: 'NSE:MM',        name: 'Mahindra & Mahindra' },
  { base: 'BAJAJ-AUTO',tv: 'NSE:BAJAJ-AUTO',twelve: 'BAJAJ-AUTO:NSE',finnhub: 'NSE:BAJAJ-AUTO',name: 'Bajaj Auto' },
  { base: 'LTIM',      tv: 'NSE:LTIM',      twelve: 'LTIM:NSE',      finnhub: 'NSE:LTIM',      name: 'LTIMindtree' },
  { base: 'HDFCLIFE',  tv: 'NSE:HDFCLIFE',  twelve: 'HDFCLIFE:NSE',  finnhub: 'NSE:HDFCLIFE',  name: 'HDFC Life Insurance' },
  { base: 'SBILIFE',   tv: 'NSE:SBILIFE',   twelve: 'SBILIFE:NSE',   finnhub: 'NSE:SBILIFE',   name: 'SBI Life Insurance' },
  { base: 'TATASTEEL', tv: 'NSE:TATASTEEL',  twelve: 'TATASTEEL:NSE', finnhub: 'NSE:TATASTEEL', name: 'Tata Steel' },
  { base: 'TATACONSUM',tv: 'NSE:TATACONSUM', twelve: 'TATACONSUM:NSE',finnhub: 'NSE:TATACONSUM',name: 'Tata Consumer Products' },
  { base: 'TATAMOTORS',tv: 'NSE:TATAMOTORS', twelve: 'TATAMOTORS:NSE',finnhub: 'NSE:TATAMOTORS',name: 'Tata Motors' },
  { base: 'NESTLEIND', tv: 'NSE:NESTLEIND',  twelve: 'NESTLEIND:NSE', finnhub: 'NSE:NESTLEIND', name: 'Nestle India' },
  { base: 'HINDUNILVR',tv: 'NSE:HINDUNILVR', twelve: 'HINDUNILVR:NSE',finnhub: 'NSE:HINDUNILVR',name: 'Hindustan Unilever' },
  { base: 'INDUSINDBK',tv: 'NSE:INDUSINDBK', twelve: 'INDUSINDBK:NSE',finnhub: 'NSE:INDUSINDBK',name: 'IndusInd Bank' },
  { base: 'DIVISLAB',  tv: 'NSE:DIVISLAB',   twelve: 'DIVISLAB:NSE',  finnhub: 'NSE:DIVISLAB',  name: "Divi's Laboratories" },
  { base: 'HEROMOTOCO',tv: 'NSE:HEROMOTOCO', twelve: 'HEROMOTOCO:NSE',finnhub: 'NSE:HEROMOTOCO',name: 'Hero MotoCorp' },
  { base: 'APOLLOHOSP',tv: 'NSE:APOLLOHOSP', twelve: 'APOLLOHOSP:NSE',finnhub: 'NSE:APOLLOHOSP',name: 'Apollo Hospitals' },
  { base: 'EICHERMOT', tv: 'NSE:EICHERMOT',  twelve: 'EICHERMOT:NSE', finnhub: 'NSE:EICHERMOT', name: 'Eicher Motors' },
  { base: 'BAJAJFINSV',tv: 'NSE:BAJAJFINSV', twelve: 'BAJAJFINSV:NSE',finnhub: 'NSE:BAJAJFINSV',name: 'Bajaj Finserv' },
  { base: 'POWERGRID', tv: 'NSE:POWERGRID',  twelve: 'POWERGRID:NSE', finnhub: 'NSE:POWERGRID', name: 'Power Grid Corp' },
  { base: 'ULTRACEMCO',tv: 'NSE:ULTRACEMCO', twelve: 'ULTRACEMCO:NSE',finnhub: 'NSE:ULTRACEMCO',name: 'UltraTech Cement' },
  { base: 'ASIANPAINT',tv: 'NSE:ASIANPAINT', twelve: 'ASIANPAINT:NSE',finnhub: 'NSE:ASIANPAINT',name: 'Asian Paints' },
  { base: 'BHARTIARTL',tv: 'NSE:BHARTIARTL', twelve: 'BHARTIARTL:NSE',finnhub: 'NSE:BHARTIARTL',name: 'Bharti Airtel' },
  { base: 'KOTAKBANK', tv: 'NSE:KOTAKBANK',  twelve: 'KOTAKBANK:NSE', finnhub: 'NSE:KOTAKBANK', name: 'Kotak Mahindra Bank' },
  { base: 'ADANIENT',  tv: 'NSE:ADANIENT',   twelve: 'ADANIENT:NSE',  finnhub: 'NSE:ADANIENT',  name: 'Adani Enterprises' },
  { base: 'ADANIPORTS',tv: 'NSE:ADANIPORTS', twelve: 'ADANIPORTS:NSE',finnhub: 'NSE:ADANIPORTS',name: 'Adani Ports' },
  { base: 'JSWSTEEL',  tv: 'NSE:JSWSTEEL',   twelve: 'JSWSTEEL:NSE',  finnhub: 'NSE:JSWSTEEL',  name: 'JSW Steel' },
  { base: 'HINDALCO',  tv: 'NSE:HINDALCO',   twelve: 'HINDALCO:NSE',  finnhub: 'NSE:HINDALCO',  name: 'Hindalco Industries' },

  // ── Standard symbols (explicit for completeness + name field) ─────────────
  { base: 'TCS',       tv: 'NSE:TCS',        twelve: 'TCS:NSE',       finnhub: 'NSE:TCS',       name: 'Tata Consultancy Services' },
  { base: 'INFY',      tv: 'NSE:INFY',       twelve: 'INFY:NSE',      finnhub: 'NSE:INFY',      name: 'Infosys' },
  { base: 'RELIANCE',  tv: 'NSE:RELIANCE',   twelve: 'RELIANCE:NSE',  finnhub: 'NSE:RELIANCE',  name: 'Reliance Industries' },
  { base: 'HDFCBANK',  tv: 'NSE:HDFCBANK',   twelve: 'HDFCBANK:NSE',  finnhub: 'NSE:HDFCBANK',  name: 'HDFC Bank' },
  { base: 'ICICIBANK', tv: 'NSE:ICICIBANK',  twelve: 'ICICIBANK:NSE', finnhub: 'NSE:ICICIBANK', name: 'ICICI Bank' },
  { base: 'WIPRO',     tv: 'NSE:WIPRO',      twelve: 'WIPRO:NSE',     finnhub: 'NSE:WIPRO',     name: 'Wipro' },
  { base: 'SBIN',      tv: 'NSE:SBIN',       twelve: 'SBIN:NSE',      finnhub: 'NSE:SBIN',      name: 'State Bank of India' },
  { base: 'AXISBANK',  tv: 'NSE:AXISBANK',   twelve: 'AXISBANK:NSE',  finnhub: 'NSE:AXISBANK',  name: 'Axis Bank' },
  { base: 'BAJFINANCE',tv: 'NSE:BAJFINANCE', twelve: 'BAJFINANCE:NSE',finnhub: 'NSE:BAJFINANCE',name: 'Bajaj Finance' },
  { base: 'MARUTI',    tv: 'NSE:MARUTI',     twelve: 'MARUTI:NSE',    finnhub: 'NSE:MARUTI',    name: 'Maruti Suzuki' },
  { base: 'SUNPHARMA', tv: 'NSE:SUNPHARMA',  twelve: 'SUNPHARMA:NSE', finnhub: 'NSE:SUNPHARMA', name: 'Sun Pharmaceutical' },
  { base: 'TECHM',     tv: 'NSE:TECHM',      twelve: 'TECHM:NSE',     finnhub: 'NSE:TECHM',     name: 'Tech Mahindra' },
  { base: 'TITAN',     tv: 'NSE:TITAN',      twelve: 'TITAN:NSE',     finnhub: 'NSE:TITAN',     name: 'Titan Company' },
  { base: 'LT',        tv: 'NSE:LT',         twelve: 'LT:NSE',        finnhub: 'NSE:LT',        name: 'Larsen & Toubro' },
  { base: 'HCLTECH',   tv: 'NSE:HCLTECH',    twelve: 'HCLTECH:NSE',   finnhub: 'NSE:HCLTECH',   name: 'HCL Technologies' },
  { base: 'ITC',       tv: 'NSE:ITC',        twelve: 'ITC:NSE',       finnhub: 'NSE:ITC',       name: 'ITC' },
  { base: 'ONGC',      tv: 'NSE:ONGC',       twelve: 'ONGC:NSE',      finnhub: 'NSE:ONGC',      name: 'ONGC' },
  { base: 'NTPC',      tv: 'NSE:NTPC',       twelve: 'NTPC:NSE',      finnhub: 'NSE:NTPC',      name: 'NTPC' },
  { base: 'BPCL',      tv: 'NSE:BPCL',       twelve: 'BPCL:NSE',      finnhub: 'NSE:BPCL',      name: 'BPCL' },
  { base: 'COALINDIA', tv: 'NSE:COALINDIA',  twelve: 'COALINDIA:NSE', finnhub: 'NSE:COALINDIA', name: 'Coal India' },
  { base: 'CIPLA',     tv: 'NSE:CIPLA',      twelve: 'CIPLA:NSE',     finnhub: 'NSE:CIPLA',     name: 'Cipla' },
  { base: 'DRREDDY',   tv: 'NSE:DRREDDY',    twelve: 'DRREDDY:NSE',   finnhub: 'NSE:DRREDDY',   name: 'Dr. Reddy\'s' },
  { base: 'BRITANNIA', tv: 'NSE:BRITANNIA',  twelve: 'BRITANNIA:NSE', finnhub: 'NSE:BRITANNIA', name: 'Britannia Industries' },
  { base: 'GRASIM',    tv: 'NSE:GRASIM',     twelve: 'GRASIM:NSE',    finnhub: 'NSE:GRASIM',    name: 'Grasim Industries' },
  { base: 'UPL',       tv: 'NSE:UPL',        twelve: 'UPL:NSE',       finnhub: 'NSE:UPL',       name: 'UPL' },

  // ── Indices ────────────────────────────────────────────────────────────────
  { base: 'NIFTY',     tv: 'NSE:NIFTY',      twelve: 'NIFTY:NSE',     finnhub: 'NSE:NIFTY',     name: 'Nifty 50' },
  { base: 'NIFTY50',   tv: 'NSE:NIFTY',      twelve: 'NIFTY:NSE',     finnhub: 'NSE:NIFTY',     name: 'Nifty 50' },
  { base: 'BANKNIFTY', tv: 'NSE:BANKNIFTY',  twelve: 'BANKNIFTY:NSE', finnhub: 'NSE:BANKNIFTY', name: 'Bank Nifty' },
  { base: 'SENSEX',    tv: 'BSE:SENSEX',     twelve: 'SENSEX:BSE',    finnhub: 'BSE:SENSEX',    name: 'BSE Sensex' },
];

// ── Build lookup indexes ──────────────────────────────────────────────────────

// Primary: base symbol → entry
const _byBase    = new Map();
// Reverse: any known format string → base symbol
const _reverseMap = new Map();

for (const entry of EXPLICIT_MAP) {
  _byBase.set(entry.base.toUpperCase(), entry);
  _reverseMap.set(entry.base.toUpperCase(),  entry.base);
  _reverseMap.set(entry.tv.toUpperCase(),    entry.base);
  _reverseMap.set(entry.twelve.toUpperCase(),entry.base);
  _reverseMap.set(entry.finnhub.toUpperCase(),entry.base);
}

// ── Default rule generators (for symbols not in EXPLICIT_MAP) ─────────────────

function _defaultTV(base)      { return `NSE:${base}`; }
function _defaultTwelve(base)  { return `${base}:NSE`; }
function _defaultFinnhub(base) { return `NSE:${base}`; }

// ── Core normaliser ───────────────────────────────────────────────────────────

/**
 * Normalise any input format to the canonical base symbol.
 *
 * Handles: "NSE:TCS", "TCS:NSE", "TCS.NSE", "NSE:TCS", "tcs", "TCS" etc.
 *
 * @param {string} input
 * @returns {string} canonical base symbol (e.g. "TCS", "M&M", "BAJAJ-AUTO")
 */
function toBase(input) {
  if (!input) return '';
  const s = input.toString().trim().toUpperCase();

  // Exact match in reverse map
  if (_reverseMap.has(s)) return _reverseMap.get(s);

  // Strip known prefixes / suffixes and retry
  const stripped = s
    .replace(/^NSE:/,  '')
    .replace(/^BSE:/,  '')
    .replace(/:NSE$/,  '')
    .replace(/:BSE$/,  '')
    .replace(/\.NSE$/, '')
    .replace(/\.BSE$/, '');

  if (_reverseMap.has(stripped)) return _reverseMap.get(stripped);
  if (_byBase.has(stripped))     return stripped;

  // Unknown symbol — return stripped as-is (best effort)
  return stripped;
}

// ── Public format converters ──────────────────────────────────────────────────

/**
 * Convert any symbol format to TradingView format.
 * e.g. "TCS", "TCS:NSE", "NSE:TCS" → "NSE:TCS"
 *
 * @param {string} input
 * @returns {string}  "NSE:SYMBOL" or "BSE:SYMBOL"
 */
function toTV(input) {
  if (!input) return 'NSE:NIFTY';
  const base  = toBase(input);
  const entry = _byBase.get(base);
  return entry ? entry.tv : _defaultTV(base);
}

/**
 * Convert any symbol format to Twelve Data API format.
 * e.g. "TCS", "NSE:TCS" → "TCS:NSE"
 * e.g. "M&M", "NSE:MM"  → "MM:NSE"
 *
 * @param {string} input
 * @returns {string}  "SYMBOL:NSE"
 */
function toTwelve(input) {
  if (!input) return 'NIFTY:NSE';
  const base  = toBase(input);
  const entry = _byBase.get(base);
  return entry ? entry.twelve : _defaultTwelve(base);
}

/**
 * Convert any symbol format to Finnhub API format.
 * e.g. "TCS", "TCS:NSE" → "NSE:TCS"
 *
 * @param {string} input
 * @returns {string}  "NSE:SYMBOL"
 */
function toFinnhub(input) {
  if (!input) return 'NSE:NIFTY';
  const base  = toBase(input);
  const entry = _byBase.get(base);
  return entry ? entry.finnhub : _defaultFinnhub(base);
}

/**
 * Get full entry for a symbol (all formats + name).
 * Returns generated defaults for unknown symbols.
 *
 * @param {string} input
 * @returns {{ base, tv, twelve, finnhub, name }}
 */
function getEntry(input) {
  const base  = toBase(input);
  const entry = _byBase.get(base);
  if (entry) return { ...entry };
  return {
    base,
    tv:      _defaultTV(base),
    twelve:  _defaultTwelve(base),
    finnhub: _defaultFinnhub(base),
    name:    base,
  };
}

/**
 * Convert any format to canonical base symbol.
 * Alias: fromAny, normalise, toBase.
 */
function fromAny(input) { return toBase(input); }

/**
 * Get all registered symbols as base names.
 * @returns {string[]}
 */
function allBaseSymbols() {
  return EXPLICIT_MAP.map(e => e.base);
}

// ── Debug helper ──────────────────────────────────────────────────────────────

/**
 * Log mapping for a symbol to all formats.
 * Useful in API error debugging.
 */
function debug(input) {
  const entry = getEntry(input);
  console.log(`[SymbolMap] "${input}" →`, entry);
  return entry;
}

module.exports = {
  toBase,
  toTV,
  toTwelve,
  toFinnhub,
  getEntry,
  fromAny,
  allBaseSymbols,
  debug,
  // Raw map for introspection
  EXPLICIT_MAP,
};
