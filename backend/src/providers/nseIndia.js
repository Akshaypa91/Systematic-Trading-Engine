// src/providers/nseIndia.js
const axios = require('axios');

// NSE requires session cookies — we maintain a persistent client
const nseClient = axios.create({
  baseURL: 'https://www.nseindia.com',
  timeout: 8000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
  },
  withCredentials: true,
});

let cookieJar = '';
let cookieExpiry = 0;

// Prime cookies by hitting the homepage first (NSE sets session cookies)
async function primeCookies() {
  if (Date.now() < cookieExpiry && cookieJar) return;
  try {
    const res = await nseClient.get('/', { timeout: 8000 });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      cookieJar = setCookie.map(c => c.split(';')[0]).join('; ');
      cookieExpiry = Date.now() + 10 * 60 * 1000; // 10 min
    }
  } catch (err) {
    // Non-fatal — some requests work without priming
  }
}

/**
 * Fetch live quote for an NSE equity symbol.
 * @param {string} symbol — e.g. "RELIANCE", "INFY", "TCS"
 * @returns {Promise<{price:number, change:number, pChange:number, prevClose:number, open:number, high:number, low:number, vwap:number, timestamp:string, source:'NSE'} | null>}
 */
async function getQuote(symbol) {
  await primeCookies();

  const url = `/api/quote-equity?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
  const res = await nseClient.get(url, {
    headers: cookieJar ? { Cookie: cookieJar } : {},
  });

  const data = res.data;
  if (!data || !data.priceInfo) {
    throw new Error(`NSE: no priceInfo for ${symbol}`);
  }

  const p = data.priceInfo;
  return {
    symbol,
    price: Number(p.lastPrice),
    change: Number(p.change),
    pChange: Number(p.pChange),
    prevClose: Number(p.previousClose),
    open: Number(p.open),
    high: Number(p.intraDayHighLow?.max),
    low: Number(p.intraDayHighLow?.min),
    vwap: Number(p.vwap),
    timestamp: data.metadata?.lastUpdateTime,
    source: 'NSE',
  };
}

module.exports = { getQuote };