// src/components/SearchBar.jsx — autocomplete with debounce + keyboard nav
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader2 } from 'lucide-react';
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Local fallback list — shows instantly before API responds
const LOCAL_STOCKS = [
  {symbol:'RELIANCE',   name:'Reliance Industries Ltd'},
  {symbol:'TCS',        name:'Tata Consultancy Services Ltd'},
  {symbol:'HDFCBANK',   name:'HDFC Bank Ltd'},
  {symbol:'INFY',       name:'Infosys Ltd'},
  {symbol:'ICICIBANK',  name:'ICICI Bank Ltd'},
  {symbol:'WIPRO',      name:'Wipro Ltd'},
  {symbol:'SBIN',       name:'State Bank of India'},
  {symbol:'AXISBANK',   name:'Axis Bank Ltd'},
  {symbol:'BAJFINANCE', name:'Bajaj Finance Ltd'},
  {symbol:'KOTAKBANK',  name:'Kotak Mahindra Bank Ltd'},
  {symbol:'HBLENGINE',  name:'HBL Power Systems Ltd'},
  {symbol:'HINDUNILVR', name:'Hindustan Unilever Ltd'},
  {symbol:'BHARTIARTL', name:'Bharti Airtel Ltd'},
  {symbol:'HCLTECH',    name:'HCL Technologies Ltd'},
  {symbol:'TATAMOTORS', name:'Tata Motors Ltd'},
  {symbol:'MARUTI',     name:'Maruti Suzuki India Ltd'},
  {symbol:'TITAN',      name:'Titan Company Ltd'},
  {symbol:'SUNPHARMA',  name:'Sun Pharmaceutical Industries Ltd'},
  {symbol:'TECHM',      name:'Tech Mahindra Ltd'},
  {symbol:'LT',         name:'Larsen & Toubro Ltd'},
  {symbol:'ADANIENT',   name:'Adani Enterprises Ltd'},
  {symbol:'ZOMATO',     name:'Zomato Ltd'},
  {symbol:'NYKAA',      name:'FSN E-Commerce Ventures Ltd'},
  {symbol:'PAYTM',      name:'One97 Communications Ltd'},
  {symbol:'IRCTC',      name:'Indian Railway Catering & Tourism Corp Ltd'},
  {symbol:'DLF',        name:'DLF Ltd'},
  {symbol:'INDIGO',     name:'InterGlobe Aviation Ltd'},
  {symbol:'DMART',      name:'Avenue Supermarts Ltd'},
  {symbol:'BANKBARODA', name:'Bank of Baroda'},
  {symbol:'PNB',        name:'Punjab National Bank'},
  {symbol:'YESBANK',    name:'Yes Bank Ltd'},
  {symbol:'IDFCFIRSTB', name:'IDFC First Bank Ltd'},
  {symbol:'BANDHANBNK', name:'Bandhan Bank Ltd'},
  {symbol:'FEDERALBNK', name:'Federal Bank Ltd'},
  {symbol:'INDUSINDBK', name:'IndusInd Bank Ltd'},
  {symbol:'MRF',        name:'MRF Ltd'},
  {symbol:'PAGEIND',    name:'Page Industries Ltd'},
  {symbol:'NESTLEIND',  name:'Nestle India Ltd'},
  {symbol:'BRITANNIA',  name:'Britannia Industries Ltd'},
  {symbol:'COALINDIA',  name:'Coal India Ltd'},
  {symbol:'ONGC',       name:'Oil & Natural Gas Corporation Ltd'},
  {symbol:'HAL',        name:'Hindustan Aeronautics Ltd'},
  {symbol:'BEL',        name:'Bharat Electronics Ltd'},
  {symbol:'TATAPOWER',  name:'Tata Power Company Ltd'},
  {symbol:'SUZLON',     name:'Suzlon Energy Ltd'},
  {symbol:'LICI',       name:'Life Insurance Corporation of India'},
];

function localSearch(q) {
  if (!q) return LOCAL_STOCKS.slice(0, 8);
  const up  = q.toUpperCase();
  const lo  = q.toLowerCase();
  const res = [];
  for (const s of LOCAL_STOCKS) {
    if (s.symbol === up)                    res.push({...s, _r:0});
    else if (s.symbol.startsWith(up))       res.push({...s, _r:1});
    else if (s.symbol.includes(up))         res.push({...s, _r:2});
    else if (s.name.toLowerCase().includes(lo)) res.push({...s, _r:3});
  }
  return res.sort((a,b)=>a._r-b._r).slice(0,10).map(({symbol,name})=>({symbol,name}));
}

// ── Highlight matched text ────────────────────────────────────────────────────
function Highlight({ text, query }) {
  if (!query || !text) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(0,212,255,0.22)', color: 'var(--cyan)', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SearchBar({ onSearch, loading }) {
  const [value,       setValue]       = useState('');
  const [focused,     setFocused]     = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [fetching,    setFetching]    = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const [showDrop,    setShowDrop]    = useState(false);

  const inputRef    = useRef(null);
  const wrapRef     = useRef(null);
  const debounceRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowDrop(false); setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback((q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Show local results immediately (no wait)
    const local = localSearch(q);
    setSuggestions(local);
    setShowDrop(local.length > 0);
    setActiveIdx(-1);

    if (!q || q.length < 1) return;

    // Then fetch from API after 250ms debounce
    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const res = await axios.get(`${BASE_URL}/data/search`, {
          params: { q, limit: 10 },
          timeout: 4000,
        });
        const apiResults = res.data?.data;
        if (Array.isArray(apiResults) && apiResults.length > 0) {
          setSuggestions(apiResults);
          setShowDrop(true);
        }
      } catch (_) {
        // keep local results on API failure
      } finally {
        setFetching(false);
      }
    }, 250);
  }, []);

  function handleChange(e) {
    const v = e.target.value;
    setValue(v);
    fetchSuggestions(v.trim());
  }

  function pick(symbol) {
    setValue(symbol);
    setShowDrop(false);
    setActiveIdx(-1);
    setSuggestions([]);
    onSearch(symbol.toUpperCase());
    inputRef.current?.blur();
  }

  function submit(e) {
    e?.preventDefault();
    // If active item selected via keyboard
    if (activeIdx >= 0 && suggestions[activeIdx]) {
      pick(suggestions[activeIdx].symbol); return;
    }
    // If only one suggestion matches, auto-pick it
    if (suggestions.length === 1) {
      pick(suggestions[0].symbol); return;
    }
    // If top suggestion is an exact prefix match, auto-pick it
    if (suggestions.length > 0 && suggestions[0].symbol.startsWith(value.trim().toUpperCase())) {
      pick(suggestions[0].symbol); return;
    }
    // Otherwise search raw input (may fail if it's a company name)
    const sym = value.trim().toUpperCase();
    if (!sym) return;
    setShowDrop(false);
    onSearch(sym);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setShowDrop(false); setActiveIdx(-1); return; }
    if (!showDrop || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx].symbol);
    }
  }

  const showList = showDrop && suggestions.length > 0;

  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });

  // Update dropdown position when shown
  useEffect(() => {
    if (showList && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setDropPos({
        top:   rect.bottom + window.scrollY,
        left:  rect.left   + window.scrollX,
        width: rect.width,
      });
    }
  }, [showList, suggestions]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
      <form onSubmit={submit}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: 'var(--bg-elevated)',
          border: `1px solid ${focused ? 'var(--border-accent)' : 'var(--border)'}`,
          borderRadius: showList ? '10px 10px 0 0' : 10,
          boxShadow: focused ? '0 0 0 3px rgba(0,212,255,0.07)' : 'none',
          transition: 'border-radius 0.1s, box-shadow 0.15s',
        }}>
          {(loading || fetching)
            ? <Loader2 size={15} style={{ color: 'var(--cyan)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            : <Search   size={15} style={{ color: focused ? 'var(--cyan)' : 'var(--text-muted)', flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onFocus={() => {
              setFocused(true);
              if (value.trim()) { fetchSuggestions(value.trim()); }
              else { setSuggestions(localSearch('')); setShowDrop(true); }
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Type symbol or company — e.g. icici, bank, hbl..."
            spellCheck={false} autoComplete="off"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 13, fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)', letterSpacing: '0.04em',
            }}
          />
          {value && (
            <button type="button"
              onClick={() => { setValue(''); setSuggestions([]); setShowDrop(false); inputRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 2 }}>
              <X size={13} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
          <button type="submit" className="btn btn-cyan"
            disabled={!value.trim() || loading}
            style={{ padding: '5px 14px', fontSize: 11, flexShrink: 0 }}>
            Search
          </button>
        </div>
      </form>

      {/* Dropdown via portal — escapes any parent overflow/clip */}
      {showList && createPortal(
        <div style={{
          position: 'absolute',
          top:   dropPos.top,
          left:  dropPos.left,
          width: dropPos.width,
          zIndex: 99999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bright)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        }}>
          <div style={{ padding: '6px 14px 4px' }}>
            <span className="section-label" style={{ fontSize: 9 }}>
              {fetching ? '⟳ Searching NSE...' : `${suggestions.length} results`}
            </span>
          </div>

          {suggestions.map((stock, i) => (
            <button key={stock.symbol} type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(stock.symbol); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 14px',
                border: 'none',
                borderTop: '1px solid rgba(255,255,255,0.03)',
                background: i === activeIdx ? 'rgba(0,212,255,0.07)' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.08s',
              }}
            >
              <span className="font-mono" style={{
                fontSize: 12, fontWeight: 700, minWidth: 110, flexShrink: 0,
                color: i === activeIdx ? 'var(--cyan)' : 'var(--text-primary)',
              }}>
                <Highlight text={stock.symbol} query={value.trim()} />
              </span>
              <span style={{
                fontSize: 11, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
              }}>
                <Highlight text={stock.name} query={value.trim()} />
              </span>
              <span className="font-mono" style={{
                fontSize: 9, color: 'var(--text-muted)', flexShrink: 0,
                padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)',
              }}>NSE</span>
            </button>
          ))}

          <div style={{ padding: '5px 14px 8px', borderTop: '1px solid var(--border)' }}>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              ↑↓ navigate · Enter select · Esc close
            </span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
