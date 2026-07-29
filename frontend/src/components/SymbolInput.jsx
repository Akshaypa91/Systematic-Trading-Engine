// src/components/SymbolInput.jsx
// Compact symbol autocomplete for FORM fields (Backtest config, etc.). Unlike
// the navbar SearchBar — which submits a search — this is a controlled input
// that just sets a symbol value. Local matches appear instantly, then the API
// (full NSE instrument master) refines. Keyboard: ↑/↓ navigate, Enter select,
// Esc close.
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { localSearch, searchSymbolsApi } from '../utils/stockSearch';

export default function SymbolInput({ value, onChange, placeholder = 'e.g. RELIANCE', disabled }) {
  const [open,      setOpen]      = useState(false);
  const [items,     setItems]     = useState([]);
  const [activeIdx, setActive]    = useState(-1);
  const [fetching,  setFetching]  = useState(false);
  const wrapRef  = useRef(null);
  const debRef   = useRef(null);
  const reqRef   = useRef(0);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setActive(-1); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => () => clearTimeout(debRef.current), []);

  const search = useCallback((q) => {
    clearTimeout(debRef.current);
    const local = localSearch(q);
    setItems(local);
    setOpen(local.length > 0);
    setActive(-1);
    if (!q) return;
    const myReq = ++reqRef.current;
    debRef.current = setTimeout(async () => {
      setFetching(true);
      const api = await searchSymbolsApi(q);
      // Ignore out-of-order responses from earlier keystrokes.
      if (myReq === reqRef.current && api.length) { setItems(api); setOpen(true); }
      if (myReq === reqRef.current) setFetching(false);
    }, 250);
  }, []);

  function pick(sym) {
    onChange(String(sym).toUpperCase());
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(items[activeIdx].symbol); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          className="input"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => { const v = e.target.value.toUpperCase(); onChange(v); search(v.trim()); }}
          onFocus={() => search(String(value || '').trim())}
          onKeyDown={onKeyDown}
          autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={open} aria-autocomplete="list"
          style={{ width: '100%', paddingLeft: 28, paddingRight: 26, textTransform: 'uppercase' }}
        />
        {fetching && <Loader2 size={12} className="animate-spin" style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />}
      </div>

      {open && items.length > 0 && (
        <ul role="listbox"
          style={{ position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', left: 0, right: 0, margin: 0, padding: 4,
            listStyle: 'none', maxHeight: 240, overflowY: 'auto', borderRadius: 9,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
          {items.map((it, i) => (
            <li key={`${it.symbol}-${i}`} role="option" aria-selected={i === activeIdx}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(it.symbol); }}
              style={{ padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
                background: i === activeIdx ? 'var(--bg-elevated)' : 'transparent' }}>
              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{it.symbol}</div>
              {it.name && <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
