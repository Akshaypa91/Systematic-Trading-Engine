// src/utils/stockSearch.js
// Shared NSE symbol search used by the navbar SearchBar and by form fields
// (SymbolInput). Local list answers instantly; the API (/data/search, backed by
// the full Upstox instrument master) then refines with the complete universe.
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Instant-response shortlist. NOT the tradable universe — the API covers every
// NSE equity; this only avoids an empty dropdown on the first keystroke.
export const LOCAL_STOCKS = [
  { symbol: 'RELIANCE',   name: 'Reliance Industries Ltd' },
  { symbol: 'TCS',        name: 'Tata Consultancy Services Ltd' },
  { symbol: 'HDFCBANK',   name: 'HDFC Bank Ltd' },
  { symbol: 'INFY',       name: 'Infosys Ltd' },
  { symbol: 'ICICIBANK',  name: 'ICICI Bank Ltd' },
  { symbol: 'WIPRO',      name: 'Wipro Ltd' },
  { symbol: 'SBIN',       name: 'State Bank of India' },
  { symbol: 'AXISBANK',   name: 'Axis Bank Ltd' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd' },
  { symbol: 'KOTAKBANK',  name: 'Kotak Mahindra Bank Ltd' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd' },
  { symbol: 'HCLTECH',    name: 'HCL Technologies Ltd' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd' },
  { symbol: 'TATASTEEL',  name: 'Tata Steel Ltd' },
  { symbol: 'MARUTI',     name: 'Maruti Suzuki India Ltd' },
  { symbol: 'TITAN',      name: 'Titan Company Ltd' },
  { symbol: 'SUNPHARMA',  name: 'Sun Pharmaceutical Industries Ltd' },
  { symbol: 'TECHM',      name: 'Tech Mahindra Ltd' },
  { symbol: 'LT',         name: 'Larsen & Toubro Ltd' },
  { symbol: 'ADANIENT',   name: 'Adani Enterprises Ltd' },
  { symbol: 'ADANIPOWER', name: 'Adani Power Ltd' },
  { symbol: 'ITC',        name: 'ITC Ltd' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd' },
  { symbol: 'COALINDIA',  name: 'Coal India Ltd' },
  { symbol: 'ONGC',       name: 'Oil & Natural Gas Corporation Ltd' },
  { symbol: 'HAL',        name: 'Hindustan Aeronautics Ltd' },
  { symbol: 'BEL',        name: 'Bharat Electronics Ltd' },
  { symbol: 'TATAPOWER',  name: 'Tata Power Company Ltd' },
  { symbol: 'DMART',      name: 'Avenue Supermarts Ltd' },
  { symbol: 'INDIGO',     name: 'InterGlobe Aviation Ltd' },
  { symbol: 'IRCTC',      name: 'Indian Railway Catering & Tourism Corp Ltd' },
  { symbol: 'LICI',       name: 'Life Insurance Corporation of India' },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda' },
  { symbol: 'PNB',        name: 'Punjab National Bank' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd' },
  { symbol: 'NESTLEIND',  name: 'Nestle India Ltd' },
  { symbol: 'BRITANNIA',  name: 'Britannia Industries Ltd' },
  { symbol: 'SUZLON',     name: 'Suzlon Energy Ltd' },
];

/** Rank local matches: exact → prefix → contains → name match. */
export function localSearch(q, limit = 10) {
  if (!q) return LOCAL_STOCKS.slice(0, 8);
  const up = q.toUpperCase(), lo = q.toLowerCase();
  const res = [];
  for (const s of LOCAL_STOCKS) {
    if (s.symbol === up)                        res.push({ ...s, _r: 0 });
    else if (s.symbol.startsWith(up))           res.push({ ...s, _r: 1 });
    else if (s.symbol.includes(up))             res.push({ ...s, _r: 2 });
    else if (s.name.toLowerCase().includes(lo)) res.push({ ...s, _r: 3 });
  }
  return res.sort((a, b) => a._r - b._r).slice(0, limit).map(({ symbol, name }) => ({ symbol, name }));
}

/** Full-universe search via the API; resolves to [] on failure (caller keeps local). */
export async function searchSymbolsApi(q, limit = 10) {
  if (!q) return [];
  try {
    const res = await axios.get(`${BASE_URL}/data/search`, { params: { q, limit }, timeout: 4000 });
    const rows = res.data?.data;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/** Basic NSE symbol validity (letters/digits/&/-, no spaces). */
export function isValidSymbol(s) {
  const up = String(s || '').trim().toUpperCase();
  return !!up && up.length <= 20 && /^[A-Z0-9&-]+$/.test(up);
}
