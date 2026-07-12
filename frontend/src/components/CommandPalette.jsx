// src/components/CommandPalette.jsx
// ⌘K / Ctrl+K command palette: fuzzy page navigation + NSE symbol jump.
// Symbols route to /trade?symbol=X (Trade page auto-loads the quote).
// Recent symbol jumps persist in localStorage. Pure frontend — no new APIs.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, LayoutDashboard, Zap, Radio, TrendingUp,
  ArrowLeftRight, BookOpen, BarChart2, MessageSquare, Clock3, Flame, Rocket,
} from 'lucide-react';

const PAGES = [
  { label: 'Dashboard',    path: '/',          icon: LayoutDashboard, kbd: 'G D' },
  { label: 'Trade',        path: '/trade',     icon: ArrowLeftRight,  kbd: 'G T' },
  { label: 'Live Trading', path: '/live',      icon: Zap,             kbd: 'G L' },
  { label: 'Signals',      path: '/signals',   icon: Radio,           kbd: 'G S' },
  { label: 'Screener',     path: '/screener',  icon: Search,          kbd: 'G C' },
  { label: 'Backtest',     path: '/backtest',  icon: TrendingUp,      kbd: 'G B' },
  { label: 'Analytics',    path: '/analytics', icon: BarChart2,       kbd: 'G A' },
  { label: 'Swing Setup',  path: '/swing',     icon: Rocket,          kbd: 'G W' },
  { label: 'Journal',      path: '/journal',   icon: BookOpen,        kbd: 'G J' },
  { label: 'Feedback',     path: '/feedback',  icon: MessageSquare },
];

const POPULAR = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'WIPRO', 'SBIN', 'AXISBANK'];
const RECENTS_KEY = 'systra.palette.recents';

function readRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; } catch { return []; }
}

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const recents = useMemo(() => (open ? readRecents() : []), [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const pageItems = PAGES
      .filter((p) => !q || p.label.toLowerCase().includes(q))
      .map((p) => ({ type: 'page', ...p }));

    const symPool = [...new Set([...recents, ...POPULAR])];
    const symbolItems = symPool
      .filter((s) => !q || s.toLowerCase().includes(q))
      .slice(0, 8)
      .map((s) => ({ type: 'symbol', label: s, recent: recents.includes(s) }));

    // Free-typed symbol (uppercase, no spaces) not in the pool → offer it too.
    const upper = query.trim().toUpperCase();
    if (upper && upper.length <= 20 && !upper.includes(' ') && !symPool.includes(upper)) {
      symbolItems.push({ type: 'symbol', label: upper, adhoc: true });
    }
    return [...pageItems, ...symbolItems];
  }, [q, query, recents]);

  const run = useCallback((item) => {
    if (!item) return;
    if (item.type === 'page') {
      navigate(item.path);
    } else {
      const next = [item.label, ...readRecents().filter((s) => s !== item.label)].slice(0, 6);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      navigate(`/trade?symbol=${encodeURIComponent(item.label)}`);
    }
    onClose();
  }, [navigate, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, active, run, onClose]);

  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  const firstSymbolIdx = items.findIndex((i) => i.type === 'symbol');

  // Portaled to <body>: the navbar's backdrop-filter would otherwise trap
  // this fixed overlay inside the 52px header.
  return createPortal(
    <div className="cmdk-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-input-row">
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to a page or search an NSE symbol…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search pages and symbols"
          />
          <span className="kbd">esc</span>
        </div>

        <div className="cmdk-list" role="listbox">
          {items.length === 0 && <div className="cmdk-empty">No matches for “{query}”</div>}
          {items.map((item, i) => {
            const Icon = item.type === 'page' ? item.icon : item.recent ? Clock3 : Flame;
            return (
              <div key={`${item.type}-${item.label}`}>
                {i === 0 && item.type === 'page' && <div className="cmdk-section">Pages</div>}
                {i === firstSymbolIdx && firstSymbolIdx !== -1 && <div className="cmdk-section">Symbols</div>}
                <button
                  className="cmdk-item"
                  data-active={i === active}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(item)}
                >
                  <Icon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
                  <span className={item.type === 'symbol' ? 'mono' : undefined} style={item.type === 'symbol' ? { fontWeight: 700 } : undefined}>
                    {item.label}
                  </span>
                  <span className="cmdk-meta">
                    {item.type === 'page' ? item.kbd : item.adhoc ? 'open in Trade' : item.recent ? 'recent' : 'popular'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="cmdk-foot">
          <span>↑↓ navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CornerDownLeft size={10} /> select
          </span>
          <span style={{ marginLeft: 'auto' }}>SYSTRA</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
