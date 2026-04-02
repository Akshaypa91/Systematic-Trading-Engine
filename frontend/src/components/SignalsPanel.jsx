import { useState } from 'react';
import { signalAPI } from '../services/api';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertCircle } from 'lucide-react';

const POPULAR_SYMBOLS = ['RELIANCE', 'INFY', 'TCS', 'HDFC', 'ICICIBANK', 'WIPRO', 'HDFCBANK', 'SBIN'];

function SignalBadge({ signal }) {
  const cfg = {
    BUY:  { bg: 'rgba(0,230,118,0.12)', border: 'rgba(0,230,118,0.3)',  color: 'var(--accent-green)', icon: TrendingUp,   label: 'BUY'  },
    SELL: { bg: 'rgba(255,71,87,0.12)',  border: 'rgba(255,71,87,0.3)',  color: 'var(--accent-red)',   icon: TrendingDown, label: 'SELL' },
    HOLD: { bg: 'rgba(255,167,38,0.12)', border: 'rgba(255,167,38,0.3)', color: 'var(--accent-amber)', icon: Minus,        label: 'HOLD' },
  };
  const c = cfg[signal] || cfg.HOLD;
  const Icon = c.icon;
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      <Icon size={10} />
      {c.label}
    </span>
  );
}

function ConfidenceBar({ value = 0 }) {
  const pct = Math.round(value * 100);
  const color = pct > 70 ? 'var(--accent-green)' : pct > 40 ? 'var(--accent-amber)' : 'var(--accent-red)';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
    </div>
  );
}

export default function SignalsPanel({ signals: initialSignals = [] }) {
  const [signals, setSignals] = useState(initialSignals);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [customSymbol, setCustomSymbol] = useState('');

  async function fetchSignal(symbol) {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await signalAPI.get(symbol.toUpperCase());
      const data = res.data;
      setSignals(prev => {
        const filtered = prev.filter(s => s.symbol !== data.symbol);
        return [{ symbol: data.symbol, signal: data.signal, confidence: data.confidence,
                  price: data.currentPrice, strategy: data.strategy || 'AGGREGATED',
                  ts: new Date().toLocaleTimeString('en-IN', { hour12: false }) }, ...filtered].slice(0, 12);
      });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to fetch signal');
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    if (!signals.length) { await fetchSignal(POPULAR_SYMBOLS[0]); return; }
    setLoading(true);
    for (const s of signals) {
      try {
        const res = await signalAPI.get(s.symbol);
        const d = res.data;
        setSignals(prev => prev.map(x =>
          x.symbol === d.symbol ? { ...x, signal: d.signal, confidence: d.confidence, price: d.currentPrice, ts: new Date().toLocaleTimeString('en-IN', { hour12: false }) } : x
        ));
      } catch {}
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="relative w-2 h-2">
            <div className="absolute inset-0 rounded-full" style={{ background: 'var(--accent-green)' }} />
            <div className="pulse-ring" style={{ background: 'var(--accent-green)', opacity: 0.4 }} />
          </div>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>LIVE SIGNALS</span>
        </div>
        <button onClick={refreshAll} disabled={loading}
          className="p-1.5 rounded transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-cyan)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Quick-fetch chips */}
      <div className="flex flex-wrap gap-1 mb-3">
        {POPULAR_SYMBOLS.slice(0, 5).map(sym => (
          <button key={sym} onClick={() => fetchSignal(sym)}
            className="px-2 py-0.5 rounded text-xs font-mono transition-all"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; e.currentTarget.style.color = 'var(--accent-cyan)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
            {sym}
          </button>
        ))}
      </div>

      {/* Custom symbol input */}
      <div className="flex gap-2 mb-3">
        <input
          value={customSymbol}
          onChange={e => setCustomSymbol(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && fetchSignal(customSymbol)}
          placeholder="SYMBOL..."
          className="flex-1 px-3 py-1.5 rounded text-xs font-mono outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
        <button onClick={() => fetchSignal(customSymbol)} disabled={loading || !customSymbol}
          className="px-3 py-1.5 rounded text-xs font-mono transition-all disabled:opacity-40"
          style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--accent-cyan)' }}>
          GET
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs font-mono px-3 py-2 rounded mb-2"
          style={{ background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', color: 'var(--accent-red)' }}>
          <AlertCircle size={11} /> {error}
        </div>
      )}

      {/* Signals list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2">
        {signals.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>No signals fetched yet</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Click a symbol above</div>
          </div>
        ) : (
          signals.map((s, i) => (
            <div key={`${s.symbol}-${i}`}
              className="p-3 rounded-lg fade-in"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{s.symbol}</span>
                  <span className="text-xs font-mono ml-2" style={{ color: 'var(--text-muted)' }}>
                    {s.price ? `₹${Number(s.price).toLocaleString('en-IN')}` : ''}
                  </span>
                </div>
                <SignalBadge signal={s.signal} />
              </div>
              <ConfidenceBar value={s.confidence} />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{s.strategy}</span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{s.ts}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
