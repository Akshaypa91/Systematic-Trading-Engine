import { useState } from 'react';
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
    } catch (e) { setError(e.response?.data?.error || 'Failed'); }
    setLoading(false);
  }

  const filters = ['ALL','BUY','SELL','HOLD'];
  const fColors = { ALL:'var(--cyan)', BUY:'var(--green)', SELL:'var(--red)', HOLD:'var(--amber)' };

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
              className="font-mono" style={{ padding:'2px 8px', borderRadius:5, fontSize:9, cursor:'pointer',
                fontWeight:600, border:`1px solid ${filter===f ? fColors[f]+'55' : 'var(--border)'}`,
                background: filter===f ? `${fColors[f]}12` : 'transparent',
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
                onMouseEnter={e=>{ e.currentTarget.style.borderColor='rgba(0,212,255,0.4)'; e.currentTarget.style.color='var(--cyan)'; }}
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

      {error && (
        <div className="flex items-center gap-2 font-mono" style={{ padding:'8px 12px', borderRadius:7, background:'rgba(255,77,106,0.08)', border:'1px solid rgba(255,77,106,0.2)', color:'var(--red)', fontSize:11, marginBottom:8 }}>
          <AlertCircle size={11} />{error}
        </div>
      )}

      {/* Signal cards */}
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
        {filtered.length === 0 ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, opacity:0.5 }}>
            <AlertCircle size={22} style={{ color:'var(--text-muted)' }} />
            <p className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>
              {merged.length === 0 ? 'Click a symbol to fetch signals' : `No ${filter} signals`}
            </p>
          </div>
        ) : (
          filtered.map(s => <SignalCard key={s.symbol} signal={s} />)
        )}
      </div>
    </div>
  );
}
