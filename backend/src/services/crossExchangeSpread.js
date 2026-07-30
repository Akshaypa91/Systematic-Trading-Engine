// src/services/crossExchangeSpread.js
// ─────────────────────────────────────────────────────────────────────────────
// NSE ↔ BSE price-difference monitor — the realistic version of the "HFT price
// difference" idea.
//
// What this IS: the same security quoted on two exchanges, with the spread
// measured in ₹ and basis points, AND the round-trip transaction cost required
// to capture it. The verdict field says plainly whether the spread survives
// costs.
//
// What this is NOT: an HFT arbitrage engine. Honest constraints, from this
// system's own measurements:
//   • price feed refresh ≈ 1500 ms;  API latency 80–270 ms;  broker order
//     placement 100–500 ms → total reaction time ~1–2 SECONDS.
//   • Real cash-market arbitrage closes in milliseconds from colocated servers
//     with direct market access. By the time we could act, the spread is gone.
//   • A true two-leg arb also needs inventory on both exchanges (you cannot
//     naked-short the cash market intraday to sell the expensive leg).
// So treat this as measurement and education: it will usually show that the
// spread is far SMALLER than the cost of trading it. That is the real lesson.
//
// Both legs share one ISIN, so the BSE key is derived from the NSE key
// (NSE_EQ|INE002A01018 → BSE_EQ|INE002A01018).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const axios   = require('axios');
const symbols = require('../config/symbols');
const txCosts = require('../utils/transactionCosts');
const logger  = require('../config/logger');

const QUOTE_URL = 'https://api.upstox.com/v2/market-quote/ltp';
const TIMEOUT   = 8000;

let _auth = null;
function _token() {
  if (!_auth) { try { _auth = require('./upstoxAuth'); } catch (_) {} }
  return _auth?.getAccessToken?.() || null;
}

/** NSE instrument key → BSE key for the same ISIN. */
function toBseKey(nseKey) {
  if (!nseKey || typeof nseKey !== 'string') return null;
  const [, isin] = nseKey.split('|');
  return isin ? `BSE_EQ|${isin}` : null;
}

/**
 * Pure spread math — no I/O, unit-tested.
 * @param {number} nse price on NSE
 * @param {number} bse price on BSE
 * @param {number} qty shares per leg (for cost modelling)
 * @returns {{spreadAbs, spreadBps, cheaper, costPerShare, costBps, net Bps, capturable, verdict}}
 */
function analyseSpread(nse, bse, qty = 1) {
  const a = Number(nse), b = Number(bse);
  if (!(a > 0) || !(b > 0)) return null;
  const spreadAbs = Math.abs(a - b);
  const mid       = (a + b) / 2;
  const spreadBps = +((spreadAbs / mid) * 10000).toFixed(2);
  const cheaper   = a < b ? 'NSE' : 'BSE';

  // Capturing the spread = BUY the cheap leg + SELL the expensive leg. That is a
  // full round trip's worth of charges (both legs), so use roundTripCost.
  const q = Math.max(1, Math.floor(qty));
  let costTotal = 0;
  try {
    const rt = txCosts.roundTripCost({ entryPrice: Math.min(a, b), exitPrice: Math.max(a, b), quantity: q });
    costTotal = Number(rt?.totalCost ?? rt?.total ?? 0);
  } catch (_) { costTotal = 0; }
  const costPerShare = q > 0 ? costTotal / q : 0;
  const costBps      = +((costPerShare / mid) * 10000).toFixed(2);
  const netBps       = +(spreadBps - costBps).toFixed(2);
  const capturable   = netBps > 0;

  return {
    nse: a, bse: b, mid: +mid.toFixed(2),
    spreadAbs: +spreadAbs.toFixed(4), spreadBps,
    cheaper, qty: q,
    costPerShare: +costPerShare.toFixed(4), costBps, netBps, capturable,
    verdict: capturable
      ? `Spread ${spreadBps} bps exceeds ${costBps} bps of costs by ${netBps} bps — but it will almost certainly close before a ~1–2s retail round trip completes.`
      : `NOT capturable: spread ${spreadBps} bps is smaller than ${costBps} bps of transaction costs (short by ${Math.abs(netBps)} bps).`,
  };
}

/** Fetch NSE+BSE LTP for many symbols in ONE Upstox call. */
async function fetchSpreads(symbolList, qty = 1) {
  const token = _token();
  if (!token) throw Object.assign(new Error('Upstox not authenticated'), { statusCode: 409 });

  const wanted = [];
  for (const s of (symbolList || [])) {
    const sym = String(s).toUpperCase();
    const nseKey = symbols.toUpstox(sym);
    const bseKey = toBseKey(nseKey);
    if (nseKey && bseKey) wanted.push({ sym, nseKey, bseKey });
  }
  if (!wanted.length) return { results: [], skipped: symbolList || [] };

  const keys = wanted.flatMap(w => [w.nseKey, w.bseKey]);
  let data = {};
  try {
    const res = await axios.get(QUOTE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'Api-Version': '2.0', Accept: 'application/json' },
      params: { instrument_key: keys.join(',') },
      timeout: TIMEOUT,
    });
    data = res.data?.data || {};
  } catch (e) {
    throw Object.assign(new Error(`Upstox quote failed: ${e.response?.status || e.message}`), { statusCode: 502 });
  }

  // Upstox keys the response by "EXCHANGE:SYMBOL"; match on the instrument_token
  // it echoes back so we don't depend on the label format.
  const byToken = new Map();
  for (const v of Object.values(data)) {
    if (v?.instrument_token) byToken.set(v.instrument_token, Number(v.last_price));
  }

  const results = [], skipped = [];
  for (const w of wanted) {
    const nse = byToken.get(w.nseKey);
    const bse = byToken.get(w.bseKey);
    if (!(nse > 0) || !(bse > 0)) { skipped.push(w.sym); continue; }
    const a = analyseSpread(nse, bse, qty);
    if (a) results.push({ symbol: w.sym, ...a });
  }
  results.sort((x, y) => y.spreadBps - x.spreadBps);
  logger.debug(`[Spread] ${results.length} pairs, ${skipped.length} skipped`);
  return { results, skipped, qty };
}

module.exports = { analyseSpread, fetchSpreads, toBseKey };
