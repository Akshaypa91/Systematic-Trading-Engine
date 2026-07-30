// src/hooks/useGlobalShortcuts.js
// Linear-style "g then letter" navigation + "?" for help. Ignored while
// typing in any input/textarea/select/contenteditable, or with a modifier
// key held (so it never fights browser/OS shortcuts).
import { useEffect, useRef } from 'react';

// Must stay in sync with the `kbd` hints in components/Sidebar.jsx — a hint with
// no entry here is a dead shortcut the UI still advertises.
export const SHORTCUT_ROUTES = [
  { keys: 'g d', path: '/',            label: 'Dashboard' },
  { keys: 'g t', path: '/trade',       label: 'Trade' },
  { keys: 'g l', path: '/live',        label: 'Paper Engine' },
  { keys: 'g o', path: '/orders',      label: 'Live Orders' },
  { keys: 'g p', path: '/positions',   label: 'Portfolio' },
  { keys: 'g s', path: '/signals',     label: 'Signals' },
  { keys: 'g c', path: '/screener',    label: 'Screener' },
  { keys: 'g b', path: '/backtest',    label: 'Backtest' },
  { keys: 'g a', path: '/analytics',   label: 'Analytics' },
  { keys: 'g w', path: '/swing',       label: 'Swing Setup' },
  { keys: 'g r', path: '/spread',      label: 'NSE-BSE Spread' },
  { keys: 'g j', path: '/journal',     label: 'Journal' },
  { keys: 'g e', path: '/execution',   label: 'Execution Quality' },
  { keys: 'g x', path: '/diagnostics', label: 'Diagnostics' },
];

const ROUTE_MAP = SHORTCUT_ROUTES.reduce((m, r) => {
  m[r.keys.split(' ')[1]] = r.path;
  return m;
}, {});

export function useGlobalShortcuts({ onOpenHelp, navigate }) {
  const pendingG = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        onOpenHelp?.();
        return;
      }

      if (pendingG.current) {
        pendingG.current = false;
        clearTimeout(timerRef.current);
        const path = ROUTE_MAP[e.key.toLowerCase()];
        if (path) { e.preventDefault(); navigate?.(path); }
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        pendingG.current = true;
        timerRef.current = setTimeout(() => { pendingG.current = false; }, 900);
      }
    }

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(timerRef.current);
    };
  }, [onOpenHelp, navigate]);
}
