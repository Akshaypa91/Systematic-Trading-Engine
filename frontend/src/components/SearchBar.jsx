// src/components/SearchBar.jsx — autocomplete with debounce + keyboard nav
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// ── Highlight matched substring ───────────────────────────────────────────────
function Highlight({ text, query }) {
  if (!query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(0,212,255,0.2)', color: 'var(--cyan)', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

export default function SearchBar({ onSearch, loading }) {
  const [value,       setValue]       = useState('');
  const [focused,     setFocused]     = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [fetching,    setFetching]    = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const [showDrop,    setShowDrop]    = useState(false);

  const inputRef   = useRef(null);
  const wrapRef    = useRef(null);
  const debounceRef = useRef(null);
  const abortRef   = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowDrop(false); setActiveIdx(-1);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced fetch
  const fetchSuggestions = useCallback((q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q || q.length < 1) { setSuggestions([]); setShowDrop(false); return; }

    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const res = await axios.get(`${BASE_URL}/data/search`, {
          params: { q, limit: 10 },
          timeout: 5000,
        });
        setSuggestions(res.data?.data || []);
        setShowDrop(true);
        setActiveIdx(-1);
      } catch (e) {
        if (!axios.isCancel(e)) setSuggestions([]);
      } finally {
        setFetching(false);
      }
    }, 250);
  }, []);

  function handleChange(e) {
    const v = e.target.value;
    setValue(v);
    fetchSuggestions(v.trim());
    setShowDrop(true);
  }

  function pick(symbol) {
    setValue(symbol);
    setShowDrop(false);
    setActiveIdx(-1);
    setSuggestions([]);
    onSearch(symbol.toUpperCase());
  }

  function submit(e) {
    e?.preventDefault();
    if (activeIdx >= 0 && suggestions[activeIdx]) {
      pick(suggestions[activeIdx].symbol);
      return;
    }
    const sym = value.trim().toUpperCase();
    if (!sym) return;
    setShowDrop(false);
    onSearch(sym);
  }

  function handleKeyDown(e) {
    if (!showDrop || !suggestions.length) {
      if (e.key === 'Escape') { setValue(''); setSuggestions([]); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setShowDrop(false); setActiveIdx(-1);
    }
  }

  const showList = showDrop && suggestions.length > 0;

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
          transition: 'all 0.15s',
        }}>
          {(loading || fetching)
            ? <Loader2 size={15} style={{ color: 'var(--cyan)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            : <Search   size={15} style={{ color: focused ? 'var(--cyan)' : 'var(--text-muted)', flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onFocus={() => { setFocused(true); if (value.trim()) setShowDrop(true); }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Search stock — e.g. RELI, HBL, bank..."
            spellCheck={false} autoComplete="off"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 13, fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)', letterSpacing: '0.04em',
            }}
          />
          {value && (
            <button type="button" onClick={() => { setValue(''); setSuggestions([]); setShowDrop(false); }}
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

      {/* Autocomplete dropdown */}
      {showList && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bright)',
          borderTop: 'none',
          borderRadius: '0 0 10px 10px',
          overflow: 'hidden',
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
        }}>
          {suggestions.map((stock, i) => (
            <button key={stock.symbol} type="button"
              onMouseDown={() => pick(stock.symbol)}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '9px 14px',
                border: 'none', borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                background: i === activeIdx ? 'rgba(0,212,255,0.06)' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.08s',
              }}
            >
              {/* Symbol */}
              <span className="font-mono" style={{
                fontSize: 12, fontWeight: 700,
                color: i === activeIdx ? 'var(--cyan)' : 'var(--text-primary)',
                minWidth: 100, flexShrink: 0,
              }}>
                <Highlight text={stock.symbol} query={value.trim()} />
              </span>
              {/* Name */}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Highlight text={stock.name} query={value.trim()} />
              </span>
              {/* NSE badge */}
              <span className="font-mono" style={{
                fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0,
                padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)',
              }}>NSE</span>
            </button>
          ))}

          {/* Hint */}
          <div style={{ padding: '5px 14px 8px', borderTop: '1px solid var(--border)' }}>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              ↑↓ navigate · Enter select · Esc close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
