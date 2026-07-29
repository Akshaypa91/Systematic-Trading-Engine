// src/components/SymbolInput.jsx
// Compact symbol autocomplete for FORM fields (Backtest config, etc.). Unlike
// the navbar SearchBar — which submits a search — this is a controlled input
// that just sets a symbol value. Local matches appear instantly, then the API
// (full NSE instrument master) refines. Keyboard: ↑/↓ navigate, Enter select,
// Esc close.
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Loader2, CornerDownLeft, X } from 'lucide-react';
import { localSearch, searchSymbolsApi, prettifyName } from '../utils/stockSearch';

// Highlight the matched substring so it's obvious WHY a row matched.
function Mark({ text, q }) {
  const s = String(text ?? '');
  if (!q) return <>{s}</>;
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return <>{s}</>;
  return (
    <>
      {s.slice(0, i)}
      <mark style={{ background: 'color-mix(in srgb, var(--cyan) 24%, transparent)', color: 'var(--cyan)', borderRadius: 2, padding: '0 1px' }}>
        {s.slice(i, i + q.length)}
      </mark>
      {s.slice(i + q.length)}
    </>
  );
}

export default function SymbolInput({ value, onChange, placeholder = 'e.g. RELIANCE', disabled }) {
  const [open,      setOpen]      = useState(false);
  const [items,     setItems]     = useState([]);
  const [activeIdx, setActive]    = useState(-1);
  const [fetching,  setFetching]  = useState(false);
  const [query,     setQuery]     = useState('');   // what the list was matched on
  const wrapRef  = useRef(null);
  const listRef  = useRef(null);
  const inputRef = useRef(null);
  const debRef   = useRef(null);
  const reqRef   = useRef(0);

  // Keep the keyboard-highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    listRef.current.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setActive(-1); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => () => clearTimeout(debRef.current), []);

  const search = useCallback((q) => {
    clearTimeout(debRef.current);
    setQuery(q);
    const local = localSearch(q);
    setItems(local);
    setOpen(true);          // open even when empty so the "no match" hint shows
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
          ref={inputRef}
          className="input"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => { const v = e.target.value.toUpperCase(); onChange(v); search(v.trim()); }}
          onFocus={(e) => {
            // Select the existing value so typing REPLACES it — a pre-filled
            // field shouldn't force you to clear it before searching. Show the
            // popular list rather than matches for the value you're replacing.
            e.target.select();
            search('');
          }}
          onKeyDown={onKeyDown}
          autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={open} aria-autocomplete="list"
          style={{ width: '100%', paddingLeft: 28, paddingRight: value ? 46 : 26, textTransform: 'uppercase' }}
        />
        {value && !disabled && (
          <button type="button" aria-label="Clear symbol"
            onMouseDown={(e) => { e.preventDefault(); onChange(''); search(''); inputRef.current?.focus(); }}
            style={{ position: 'absolute', right: fetching ? 26 : 8, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={12} />
          </button>
        )}
        {fetching && <Loader2 size={12} className="animate-spin" style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />}
      </div>

      {open && (
        <div style={{ position: 'absolute', zIndex: 60, top: 'calc(100% + 4px)', left: 0, right: 0, borderRadius: 9,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 10px 30px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
          {items.length > 0 ? (
            <>
              <ul ref={listRef} role="listbox"
                style={{ margin: 0, padding: 4, listStyle: 'none', maxHeight: 240, overflowY: 'auto' }}>
                {items.map((it, i) => {
                  const exact = query && it.symbol.toUpperCase() === query.toUpperCase();
                  return (
                    <li key={`${it.symbol}-${i}`} role="option" aria-selected={i === activeIdx}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => { e.preventDefault(); pick(it.symbol); }}
                      style={{ padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
                        background: i === activeIdx ? 'var(--bg-elevated)' : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          <Mark text={it.symbol} q={query} />
                        </span>
                        {exact && (
                          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.05em', padding: '1px 5px', borderRadius: 99,
                            background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>EXACT</span>
                        )}
                      </div>
                      {it.name && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Mark text={prettifyName(it.name)} q={query} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderTop: '1px solid var(--border)',
                fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                <CornerDownLeft size={9} /> select · ↑↓ navigate · esc close
              </div>
            </>
          ) : (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              No match for <b style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{query}</b>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                It will still be used as typed — backtest will fail if the symbol isn't on NSE.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
