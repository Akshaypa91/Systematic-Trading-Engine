import { useEffect, useRef, useState } from 'react';
import { useWS } from '../context/WSContext';
import { signalAPI } from '../services/api';
import SignalCard from './SignalCard';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertCircle } from 'lucide-react';

const QUICK = ['RELIANCE','INFY','TCS','HDFCBANK','ICICIBANK','WIPRO'];

export default function SignalsPanel({ signals: propSignals }) {
  const { signals: wsSignals } = useWS();
  const signals = (wsSignals.length > 0 ? wsSignals : propSignals) || [];

  const [localSigs, setLocalSigs] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [filter,    setFilter]    = useState('ALL');
  const [custom,    setCustom]    = useState('');

  // Merge WS signals into local signals (WS takes priority)
  const merged = signals.length > 0 ? signals
    : localSigs;

  // Auto-populate on mount. A broker app never opens onto an empty panel and
  // asks the user to click things — if the WS stream hasn't delivered signals
  // within a couple of seconds, fetch the default watchlist ourselves.
  // Sequential with a small gap so a cold backend isn't hit by 6 at once;
  // failures (e.g. 503 NO_MARKET_DATA) are silently skipped, not shown as
  // errors — an unprompted background fill shouldn't produce error banners.
  const autoloaded = useRef(false);
  useEffect(() => {
    if (autoloaded.current) return;
    const t = setTimeout(async () => {
      if (autoloaded.current || signals.length > 0 || localSigs.length > 0) return;
      autoloaded.current = true;
      for (const sym of QUICK.slice(0, 5)) {
        try {
          const res = await signalAPI.get(sym);
          const d = res.data;
          setLocalSigs(prev => {
            const next = prev.filter(x => x.symbol !== d.symbol);
            return [...next, { ...d, timestamp: new Date().toISOString() }];
          });
        } catch { /* no data for this symbol — skip quietly */ }
        await new Promise(r => setTimeout(r, 350));
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [signals.length, localSigs.length]);

  const filtered = filter === 'ALL' ? merged : merged.filter(s => s.signal === filter);

  async function fetch1(symbol) {
    if (!symbol) return;
    setLoading(true); setError(null);
    try {
      const res = await signalAPI.get(symbol.toUpperCase());
      const d = res.data;
      setLocalSigs(prev => {
        const next = prev.filter(s => s.symbol !== d.symbol);
        return [{ ...d, timestamp: new Date().toISOString() }, ...next].slice(0, 20);
      });
    } catch (e) {
      // The backend returns 503 NO_MARKET_DATA rather than inventing a signal.
      // Show its explanation, which tells the user what to actually do about it.
      const d = e.response?.data;
      setError(d?.message || d?.error || 'Failed');
    }
    setLoading(false);
  }

  const filters = ['ALL','BUY','SELL','HOLD'];
  const fColors = { ALL:'var(--cyan)', BUY:'var(--green)', SELL:'var(--red)', HOLD:'var(--amber)' };

  // If nothing on screen is a real-time quote, say so once at the top rather
  // than relying on the user to read the badge on every card.
  const anyLive = merged.some(s => String(s.source || '').toUpperCase() === 'LIVE');
  const showDelayedNote = merged.length > 0 && !anyLive;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom:12 }}>
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="section-label">Live Signals</span>
          <span className="font-mono" style={{ fontSize:10, padding:'1px 6px', borderRadius:4, background:'var(--bg-elevated)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>
            {merged.length}
          </span>
        </div>

        <div className="flex gap-1">
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              aria-pressed={filter===f}
              className="font-mono" style={{ padding:'2px 8px', borderRadius:5, fontSize:9, cursor:'pointer',
                fontWeight:600, border:`1px solid ${filter===f ? `color-mix(in srgb, ${fColors[f]} 33%, transparent)` : 'var(--border)'}`,
                background: filter===f ? `color-mix(in srgb, ${fColors[f]} 7%, transparent)` : 'transparent',
                color: filter===f ? fColors[f] : 'var(--text-muted)' }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Quick fetch chips */}
      {merged.length === 0 && (
        <>
          <div className="flex flex-wrap gap-1.5" style={{ marginBottom:10 }}>
            {QUICK.map(sym => (
              <button key={sym} onClick={() => fetch1(sym)} className="font-mono"
                style={{ padding:'3px 8px', borderRadius:5, fontSize:10, cursor:'pointer',
                  background:'var(--bg-elevated)', border:'1px solid var(--border)', color:'var(--text-muted)',
                  transition:'all 0.15s' }}
                onMouseEnter={e=>{ e.currentTarget.style.borderColor='color-mix(in srgb, var(--cyan) 40%, transparent)'; e.currentTarget.style.color='var(--cyan)'; }}
                onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-muted)'; }}>
                {sym}
              </button>
            ))}
          </div>
          <div className="flex gap-2" style={{ marginBottom:12 }}>
            <input value={custom} onChange={e=>setCustom(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==='Enter' && fetch1(custom)}
              placeholder="SYMBOL..." className="input" style={{ fontSize:11 }} />
            <button onClick={()=>fetch1(custom)} disabled={!custom||loading} className="btn btn-cyan" style={{ padding:'6px 12px', flexShrink:0 }}>
              {loading ? <RefreshCw size={11} className="animate-spin" /> : 'GET'}
            </button>
          </div>
        </>
      )}

      {showDelayedNote && (
        <div className="flex items-center gap-2 font-mono" style={{ padding:'7px 11px', borderRadius:7, background:'color-mix(in srgb, var(--amber) 7%, transparent)', border:'1px solid color-mix(in srgb, var(--amber) 20%, transparent)', color:'var(--amber)', fontSize:10.5, marginBottom:8, lineHeight:1.45 }}>
          <AlertCircle size={11} style={{ flexShrink:0 }} />
          <span>Delayed prices — computed on the last stored close. Connect Upstox for real-time signals.</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 font-mono" style={{ padding:'8px 12px', borderRadius:7, background:'color-mix(in srgb, var(--red) 8%, transparent)', border:'1px solid color-mix(in srgb, var(--red) 20%, transparent)', color:'var(--red)', fontSize:11, marginBottom:8 }}>
          <AlertCircle size={11} />{error}
        </div>
      )}

      {/* Signal cards — capped height with internal scroll so the panel can't
          stretch the dashboard grid row to thousands of pixels */}
      <div className="scroll-y" style={{ flex:1, minHeight:160, maxHeight:520, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.length === 0 ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, opacity:0.5 }}>
            <AlertCircle size={22} style={{ color:'var(--text-muted)' }} />
            <p className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>
              {merged.length === 0 ? 'No market data — click a symbol to fetch' : `No ${filter} signals`}
            </p>
          </div>
        ) : (
          filtered.map(s => <SignalCard key={s.symbol} signal={s} />)
        )}
      </div>
    </div>
  );
}
