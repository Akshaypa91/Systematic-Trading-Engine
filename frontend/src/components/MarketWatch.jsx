import { useEffect, useRef, useState } from 'react';
import { useWS } from '../context/WSContext';
import { Sparkline, Badge, EmptyState } from './ui';
import { signalTone } from './ui/signal';
import { price } from '../utils/format';
import { Radio } from 'lucide-react';

/**
 * MarketWatch — a compact live watchlist.
 * Subscribes to WS price feeds for `symbols`, keeps a short rolling price
 * history per symbol to draw a live sparkline, and overlays the latest signal
 * badge from the WS signal stream. Purely reflects real feed data.
 */
const HISTORY = 24;

export default function MarketWatch({ symbols = [] }) {
  const { prices, signals, subscribe, unsubscribe } = useWS();
  const [history, setHistory] = useState({}); // symbol -> number[]
  const prevRef = useRef({});

  // Subscribe / unsubscribe to the watched symbols.
  useEffect(() => {
    if (!symbols.length) return;
    subscribe(symbols);
    return () => unsubscribe(symbols);
  }, [symbols, subscribe, unsubscribe]);

  // Append every new tick to the rolling history.
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

  return (
    <div className="ui-vstack" style={{ gap: 8 }}>
      {symbols.map((sym) => {
        const tick = prices[sym];
        const hist = history[sym] || [];
        const sig = sigBy[sym];
        return (
          <div key={sym} className="mini-tile">
            <div className="ui-hstack" style={{ gap: 10, minWidth: 0 }}>
              <span className="sym" style={{ fontSize: 12.5, minWidth: 74 }}>{sym}</span>
              {sig && <Badge tone={signalTone(sig.signal)} style={{ fontSize: 9 }}>{sig.signal}</Badge>}
            </div>
            <div className="ui-hstack" style={{ gap: 12 }}>
              <Sparkline data={hist} width={64} height={22} />
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: tick ? 'var(--text-primary)' : 'var(--text-muted)', minWidth: 78, textAlign: 'right' }}>
                {tick ? price(tick.price) : '···'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
