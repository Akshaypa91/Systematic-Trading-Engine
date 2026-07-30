// src/components/IndicesStrip.jsx
// NIFTY 50 · SENSEX · BANK NIFTY ticker — the first thing every broker app
// shows, because a trading screen without market context feels like a form.
// Renders nothing when the backend has no real index quotes (no broker
// session): an absent strip is honest, a frozen or invented one is not.
import { useEffect, useRef, useState } from 'react';
import { marketAPI } from '../services/api';
import { TrendingUp, TrendingDown } from 'lucide-react';

const REFRESH_MS = 20000;

function fmtIdx(v) {
  return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function IndicesStrip() {
  const [indices, setIndices] = useState([]);
  const timer = useRef();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await marketAPI.getIndices();
        if (alive && Array.isArray(r.data?.data)) setIndices(r.data.data);
      } catch { /* keep last snapshot */ }
    };
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer.current); };
  }, []);

  if (!indices.length) return null;

  return (
    <div
      aria-label="Market indices"
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
      }}
    >
      {indices.map(ix => {
        const up = (ix.change ?? 0) >= 0;
        const color = up ? 'var(--green)' : 'var(--red)';
        const Arrow = up ? TrendingUp : TrendingDown;
        return (
          <div
            key={ix.name}
            className="card"
            style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              padding: '8px 14px', flex: '1 1 200px', minWidth: 0,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {ix.name}
            </span>
            <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtIdx(ix.ltp)}
            </span>
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600, color, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
              <Arrow size={11} aria-hidden="true" />
              {up ? '+' : ''}{fmtIdx(ix.change)}{ix.changePct != null ? ` (${up ? '+' : ''}${ix.changePct}%)` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
