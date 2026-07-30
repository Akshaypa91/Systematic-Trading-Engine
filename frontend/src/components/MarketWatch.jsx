import { useEffect, useRef, useState } from 'react';
import { useWS } from '../context/WSContext';
import { marketAPI } from '../services/api';
import { Sparkline, Badge, EmptyState } from './ui';
import { signalTone } from './ui/signal';
import { price } from '../utils/format';
import { Radio } from 'lucide-react';

/**
 * MarketWatch — a compact watchlist that behaves like a broker app's.
 *
 * Two data layers, clearly distinguished:
 *   1. Live WS ticks (broker connected, market open) — price updates in place,
 *      sparkline draws from the tick stream.
 *   2. Stored last closes (everything else) — real close, day change vs the
 *      previous close, sparkline from the last ~20 sessions, and an "as of"
 *      date row so nobody mistakes delayed for live.
 * A symbol with neither stays '···'. Nothing is invented.
 */
const HISTORY = 24;

export default function MarketWatch({ symbols = [] }) {
  const { prices, signals, subscribe, unsubscribe } = useWS();
  const [history, setHistory] = useState({});     // symbol → number[] (live ticks)
  const [closes,  setCloses]  = useState({});     // symbol → last-close row
  const prevRef = useRef({});

  // Subscribe / unsubscribe to the watched symbols.
  useEffect(() => {
    if (!symbols.length) return;
    subscribe(symbols);
    return () => unsubscribe(symbols);
  }, [symbols, subscribe, unsubscribe]);

  // Delayed layer: one batch call for real stored closes.
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;
    marketAPI.getLastCloses(symbols)
      .then(r => {
        if (!alive) return;
        const map = {};
        for (const row of r.data?.data || []) map[row.symbol] = row;
        setCloses(map);
      })
      .catch(() => { /* endpoint down → tiles simply stay sparse */ });
    return () => { alive = false; };
  }, [symbols]);

  // Append every new live tick to the rolling history.
  useEffect(() => {
    setHistory((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sym of symbols) {
        const p = prices[sym]?.price;
        if (p == null) continue;
        if (prevRef.current[sym] === p && (next[sym]?.length || 0) > 0) continue;
        prevRef.current[sym] = p;
        const arr = (next[sym] || []).concat(p).slice(-HISTORY);
        next[sym] = arr;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [prices, symbols]);

  const sigBy = {};
  for (const s of signals) if (s?.symbol) sigBy[s.symbol] = s;

  if (!symbols.length) {
    return <EmptyState icon={Radio} description="No symbols on watchlist" style={{ padding: '32px 0', border: 'none', background: 'transparent' }} />;
  }

  // "As of" shown once for the whole list (they share the sync date), not
  // spammed on every row.
  const anyLive = symbols.some(sym => prices[sym]?.price != null);
  const asOf = !anyLive
    ? Object.values(closes).map(c => c.asOf).sort().pop()
    : null;

  return (
    <div className="ui-vstack" style={{ gap: 8 }}>
      {symbols.map((sym) => {
        const tick = prices[sym];
        const lc   = closes[sym];
        const live = tick?.price != null;
        const shown = live ? tick.price : lc?.close;
        const spark = live && (history[sym]?.length || 0) > 1 ? history[sym] : (lc?.spark || []);
        // Day change: live price vs prev close when live, else close vs close.
        const chgPct = live
          ? (lc?.prevClose > 0 ? ((tick.price - lc.prevClose) / lc.prevClose) * 100 : null)
          : lc?.changePct;
        const up = (chgPct ?? 0) >= 0;
        const sig = sigBy[sym];
        return (
          <div key={sym} className="mini-tile">
            <div className="ui-hstack" style={{ gap: 10, minWidth: 0 }}>
              <span className="sym" style={{ fontSize: 12.5, minWidth: 74 }}>{sym}</span>
              {sig && <Badge tone={signalTone(sig.signal)} style={{ fontSize: 9 }}>{sig.signal}</Badge>}
            </div>
            <div className="ui-hstack" style={{ gap: 12 }}>
              <Sparkline data={spark} width={64} height={22} />
              <div style={{ minWidth: 92, textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: shown != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {shown != null ? price(shown) : '···'}
                </div>
                {chgPct != null && (
                  <div className="mono" style={{ fontSize: 10, fontWeight: 600, color: up ? 'var(--green)' : 'var(--red)' }}>
                    {up ? '▲' : '▼'} {Math.abs(chgPct).toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {asOf && (
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-muted)', textAlign: 'right', paddingRight: 2 }}>
          closes as of {asOf}
        </div>
      )}
    </div>
  );
}
