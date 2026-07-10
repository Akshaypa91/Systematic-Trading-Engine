// src/data/instrumentMaster.js
// ─────────────────────────────────────────────────────────────────────────────
// Loads Upstox's NSE instrument master once per day so ANY NSE equity symbol
// resolves to its instrument_key (e.g. HBLENGINE → NSE_EQ|INE292B01021), instead
// of relying on the ~40 hardcoded symbols in config/symbols.js.
//
// Best-effort: if the fetch/parse fails, the maps stay empty and callers fall
// back to the static map — nothing breaks.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const axios  = require('axios');
const zlib   = require('zlib');
const logger = require('../config/logger');

const NSE_URL = process.env.UPSTOX_INSTRUMENTS_URL
  || 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

const _bySymbol = new Map();   // TRADING_SYMBOL → instrument_key  (NSE_EQ only)
const _byKey    = new Map();   // instrument_key → TRADING_SYMBOL
let _loadedAt   = 0;
let _loading    = null;        // in-flight promise (dedupe concurrent loads)

const DAY_MS = 24 * 60 * 60 * 1000;

function isLoaded() { return _bySymbol.size > 0 && (Date.now() - _loadedAt) < DAY_MS; }

async function load(force = false) {
  if (!force && isLoaded()) return true;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      logger.info('[InstrumentMaster] fetching Upstox NSE instrument master…');
      const res = await axios.get(NSE_URL, {
        responseType: 'arraybuffer', timeout: 30_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': '*/*',
        },
      });
      let buf = Buffer.from(res.data);
      // File is gzipped; some CDNs auto-decompress. Detect the gzip magic bytes.
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      const list = JSON.parse(buf.toString('utf8'));

      _bySymbol.clear(); _byKey.clear();
      for (const it of list) {
        const seg = it.segment || it.exchange;
        // NSE equities only (skip F&O, indices, etc.)
        if (seg !== 'NSE_EQ') continue;
        const sym = String(it.trading_symbol || it.tradingsymbol || it.symbol || '').toUpperCase().trim();
        const key = it.instrument_key || it.instrumentKey;
        if (!sym || !key) continue;
        _bySymbol.set(sym, key);
        _byKey.set(key, sym);
      }
      _loadedAt = Date.now();
      logger.info(`[InstrumentMaster] loaded ${_bySymbol.size} NSE equity instruments`);
      return true;
    } catch (err) {
      logger.warn(`[InstrumentMaster] load failed (${err.message}) — using static map`);
      return false;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

function resolve(symbol) {
  if (!symbol) return null;
  return _bySymbol.get(String(symbol).toUpperCase().trim()) || null;
}
function reverse(instrumentKey) {
  if (!instrumentKey) return null;
  return _byKey.get(instrumentKey) || null;
}
function getStats() {
  return { loaded: isLoaded(), count: _bySymbol.size, loadedAt: _loadedAt ? new Date(_loadedAt).toISOString() : null };
}

module.exports = { load, resolve, reverse, isLoaded, getStats };
