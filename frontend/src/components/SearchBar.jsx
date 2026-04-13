import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

const QUICK_SYMBOLS = [
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK',
  'WIPRO', 'SBIN', 'AXISBANK', 'BAJFINANCE', 'MARUTI',
];

export default function SearchBar({ onSearch, loading }) {
  const [value, setValue]       = useState('');
  const [focused, setFocused]   = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef(null);
  const wrapRef  = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleSubmit(e) {
    e?.preventDefault();
    const sym = value.trim().toUpperCase();
    if (!sym) return;
    setShowDropdown(false);
    onSearch(sym);
  }

  function pickSymbol(sym) {
    setValue(sym);
    setShowDropdown(false);
    onSearch(sym);
  }

  function handleClear() {
    setValue('');
    inputRef.current?.focus();
  }

  const filtered = value
    ? QUICK_SYMBOLS.filter(s => s.startsWith(value.toUpperCase()))
    : QUICK_SYMBOLS;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 540 }}>

      {/* Input */}
      <form onSubmit={handleSubmit}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: 'var(--bg-elevated)',
          border: `1px solid ${focused ? 'rgba(0,212,255,0.4)' : 'var(--border)'}`,
          borderRadius: 10,
          boxShadow: focused ? '0 0 0 3px rgba(0,212,255,0.07)' : 'none',
          transition: 'all 0.15s',
        }}>
          {loading
            ? <Loader2 size={15} style={{ color: 'var(--cyan)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            : <Search size={15} style={{ color: focused ? 'var(--cyan)' : 'var(--text-muted)', flexShrink: 0, transition: 'color 0.15s' }} />
          }

          <input
            ref={inputRef}
            value={value}
            onChange={e => { setValue(e.target.value); setShowDropdown(true); }}
            onFocus={() => { setFocused(true); setShowDropdown(true); }}
            onBlur={() => setFocused(false)}
            onKeyDown={e => e.key === 'Escape' && setShowDropdown(false)}
            placeholder="Search stock — e.g. RELIANCE, INFY"
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 13, fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)', letterSpacing: '0.04em',
            }}
          />

          {value && (
            <button type="button" onClick={handleClear}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
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

      {/* Dropdown */}
      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bright)',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          animation: 'fadeUp 0.15s ease-out',
        }}>
          <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)' }}>
            <span className="section-label">Quick select</span>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: '14px 16px' }}>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                No matches — press Enter to search "{value.toUpperCase()}"
              </span>
            </div>
          ) : (
            <div style={{ padding: 6 }}>
              {filtered.map(sym => (
                <button key={sym} type="button"
                  onMouseDown={() => pickSymbol(sym)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 7, border: 'none',
                    background: 'none', cursor: 'pointer', transition: 'background 0.1s', textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--cyan)', opacity: 0.6,
                  }} />
                  <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {sym}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                    NSE
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}