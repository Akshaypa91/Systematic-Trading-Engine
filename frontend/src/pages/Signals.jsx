// src/pages/Signals.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Real-time Signal Center
//   • Primary: WebSocket SIM_TICK / LIVE_SIGNAL events (instant push)
//   • Fallback: simAPI.getSignals() polled every 3s when WS disconnected
//   • Source badge: 🟢 LIVE | 🟡 SIM per signal
//   • Full indicator display: RSI, SMA20/50, Bollinger Bands
//   • Auto-trade BUY / SELL buttons on each signal card
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import AppShell from '../components/AppShell';
import SignalCard from '../components/SignalCard';
import Toast from '../components/Toast';
import { useWS } from '../context/WSContext';
import { simAPI } from '../services/api';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw,
  Activity, Wifi, WifiOff, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const POLL_INTERVAL_MS = 3000;
const QUICK_SYMBOLS    = ['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','WIPRO','SBIN','AXISBANK'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function mergeSignal(prev, incoming) {
  const idx = prev.findIndex(s => s.symbol === incoming.symbol);
  if (idx === -1) return [incoming, ...prev];
  const next = [...prev];
  next[idx] = incoming;
  return next;
}

function mergeMany(prev, incoming = []) {
  let result = [...prev];
  for (const sig of incoming) result = mergeSignal(result, sig);
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConnectionBadge({ wsStatus, usingPoll }) {
  const live = wsStatus === 'connected' && !usingPoll;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'4px 10px', borderRadius:6,
      fontSize:10, fontWeight:700, fontFamily:'var(--font-mono)',
      background: live ? 'rgba(0,230,118,0.1)' : 'rgba(255,167,38,0.1)',
      border:     live ? '1px solid rgba(0,230,118,0.3)' : '1px solid rgba(255,167,38,0.3)',
      color:      live ? 'var(--green)' : 'var(--amber)',
    }}>
      {live ? <Wifi size={10}/> : <WifiOff size={10}/>}
      {live ? 'WS LIVE' : 'POLLING 3s'}
    </span>
  );
}

function SummaryBar({ signals }) {
  const buys  = signals.filter(s=>s.signal==='BUY').length;
  const sells = signals.filter(s=>s.signal==='SELL').length;
  const holds = signals.filter(s=>s.signal==='HOLD').length;
  const liveCount = signals.filter(s=>s.source==='LIVE').length;

  return (
    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
      {[
        { label:'BUY',  count:buys,  color:'var(--green)', Icon:TrendingUp },
        { label:'SELL', count:sells, color:'var(--red)',   Icon:TrendingDown },
        { label:'HOLD', count:holds, color:'var(--amber)', Icon:Minus },
      ].map(({label,count,color,Icon})=>(
        <div key={label} style={{
          display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:10,
          background:'var(--bg-card)', border:'1px solid var(--border)',
        }}>
          <div style={{ width:28, height:28, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', background:`${color}15`, border:`1px solid ${color}30` }}>
            <Icon size={12} style={{color}}/>
          </div>
          <div>
            <div style={{ fontSize:16, fontWeight:700, fontFamily:'var(--font-mono)', color }}>{count}</div>
            <div style={{ fontSize:9, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>{label}</div>
          </div>
        </div>
      ))}
      {liveCount > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:10, background:'var(--bg-card)', border:'1px solid rgba(0,230,118,0.2)' }}>
          <Zap size={12} style={{color:'var(--green)'}}/>
          <span style={{ fontSize:11, fontFamily:'var(--font-mono)', color:'var(--green)', fontWeight:700 }}>{liveCount} LIVE</span>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Signals() {
  const [signals,   setSignals]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [usingPoll, setUsingPoll] = useState(false);

  const pollRef    = useRef(null);
  const mountedRef = useRef(true);

  // WS context — primary data source
  const { status: wsStatus, signals: wsSignals } = useWS();

  // ── WS → signals state ────────────────────────────────────────────────────
  useEffect(() => {
    if (!wsSignals?.length) return;
    setSignals(prev => mergeMany(prev, wsSignals));
    setUsingPoll(false);
  }, [wsSignals]);

  // ── Poll fallback when WS disconnected ────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const res = await simAPI.getSignals();
      const sigs = res.data?.signals;
      if (Array.isArray(sigs) && sigs.length > 0) {
        setSignals(prev => mergeMany(prev, sigs));
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const shouldPoll = wsStatus !== 'connected';
    setUsingPoll(shouldPoll);

    if (shouldPoll) {
      fetchAll();
      pollRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    } else {
      clearInterval(pollRef.current);
    }

    return () => clearInterval(pollRef.current);
  }, [wsStatus, fetchAll]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearInterval(pollRef.current); };
  }, []);

  // ── Manual fetch for quick-add chips ─────────────────────────────────────
  async function fetchSingle(symbol) {
    setLoading(true);
    try {
      const res  = await simAPI.getSignals([symbol]);
      const sigs = res.data?.signals;
      if (Array.isArray(sigs)) {
        setSignals(prev => mergeMany(prev, sigs));
      } else {
        // Fallback: signal controller single
        const { signalAPI } = await import('../services/api');
        const r = await signalAPI.get(symbol);
        const d = r.data;
        setSignals(prev => mergeSignal(prev, {
          symbol: d.symbol, signal: d.signal, confidence: d.confidence,
          currentPrice: d.currentPrice, rsi: d.rsiValue,
          sma20: d.maFast, sma50: d.maSlow,
          bbUpper: null, bbLower: null,
          source: d.simMode ? 'SIM' : 'LIVE',
          components: d.components || {},
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || `Failed: ${symbol}`, type:'error' });
    } finally { setLoading(false); }
  }

  function removeSignal(symbol) {
    setSignals(prev => prev.filter(s => s.symbol !== symbol));
  }

  function handleTrade({ symbol, side, price, qty }) {
    setToast({
      message: `${side === 'BUY' ? '🟢' : '🔴'} ${symbol}: ${side} ×${qty} @ ₹${Number(price).toFixed(2)}`,
      type: side === 'BUY' ? 'success' : 'error',
    });
  }

  const chartData = signals.map(s => ({
    symbol:     s.symbol,
    confidence: Math.round((s.confidence||0)*100),
    signal:     s.signal,
  }));

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ padding:'24px', maxWidth:1400 }}>

          {/* Header */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, flexWrap:'wrap', gap:12 }}>
            <div>
              <h1 style={{ fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>Signal Center</h1>
              <p style={{ fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-muted)', marginTop:4 }}>
                RSI · SMA20/50 · Bollinger Bands · Real-time alerts
              </p>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <ConnectionBadge wsStatus={wsStatus} usingPoll={usingPoll}/>
              <button onClick={fetchAll} disabled={loading}
                style={{
                  display:'flex', alignItems:'center', gap:6,
                  padding:'6px 12px', borderRadius:7, fontSize:11,
                  background:'var(--bg-card)', border:'1px solid var(--border)',
                  color:'var(--text-secondary)', cursor:'pointer',
                }}>
                <RefreshCw size={11} className={loading?'animate-spin':''}/> Refresh
              </button>
            </div>
          </div>

          {/* Quick-add chips */}
          <div style={{
            padding:'14px 16px', borderRadius:10, marginBottom:18,
            background:'var(--bg-card)', border:'1px solid var(--border)',
          }}>
            <div style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>
              Quick Add
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {QUICK_SYMBOLS.map(sym => {
                const existing = signals.find(s=>s.symbol===sym);
                const sigColor = existing?.signal==='BUY' ? 'var(--green)' : existing?.signal==='SELL' ? 'var(--red)' : null;
                return (
                  <button key={sym} onClick={()=>fetchSingle(sym)}
                    style={{
                      padding:'5px 12px', borderRadius:6, fontSize:11,
                      fontFamily:'var(--font-mono)', cursor:'pointer',
                      background: existing ? 'rgba(0,212,255,0.08)' : 'var(--bg-elevated)',
                      border: existing ? '1px solid rgba(0,212,255,0.3)' : '1px solid var(--border)',
                      color: existing ? 'var(--cyan)' : 'var(--text-muted)',
                      transition:'all 0.15s',
                    }}>
                    {sym}
                    {existing && sigColor && (
                      <span style={{ marginLeft:5, color:sigColor, fontSize:9 }}>
                        {existing.signal==='BUY'?'▲':'▼'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary bar */}
          {signals.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <SummaryBar signals={signals}/>
            </div>
          )}

          {/* Confidence chart */}
          {signals.length > 0 && (
            <div style={{
              padding:'16px', borderRadius:10, marginBottom:20,
              background:'var(--bg-card)', border:'1px solid var(--border)',
            }}>
              <div style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>
                Confidence Comparison
              </div>
              <div style={{ height:120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{top:0,right:0,bottom:0,left:-20}}>
                    <XAxis dataKey="symbol" tick={{fill:'var(--text-muted)',fontSize:9,fontFamily:'var(--font-mono)'}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:'var(--text-muted)',fontSize:9,fontFamily:'var(--font-mono)'}} axisLine={false} tickLine={false} domain={[0,100]}/>
                    <Tooltip
                      formatter={v=>[`${v}%`,'Conf']}
                      contentStyle={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:6,fontFamily:'var(--font-mono)',fontSize:10}}
                      labelStyle={{color:'var(--text-secondary)'}}/>
                    <Bar dataKey="confidence" radius={[4,4,0,0]} maxBarSize={36}>
                      {chartData.map((e,i)=>(
                        <Cell key={i} fill={e.signal==='BUY'?'var(--green)':e.signal==='SELL'?'var(--red)':'var(--amber)'} fillOpacity={0.8}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Signal cards grid */}
          {signals.length === 0 ? (
            <div style={{
              padding:'64px 0', display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center',
              background:'var(--bg-card)', border:'1px dashed var(--border)', borderRadius:12,
            }}>
              <div style={{ width:48, height:48, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,212,255,0.06)', border:'1px solid var(--border)', marginBottom:14 }}>
                <Activity size={22} style={{color:'var(--text-muted)'}}/>
              </div>
              <p style={{ color:'var(--text-secondary)', fontWeight:600, margin:'0 0 6px' }}>No Signals Yet</p>
              <p style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text-muted)', margin:0 }}>
                Click a chip above or wait for WebSocket push
              </p>
            </div>
          ) : (
            <div style={{
              display:'grid',
              gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))',
              gap:14,
            }}>
              {signals.map(s => (
                <div key={s.symbol} style={{ position:'relative' }}>
                  <button
                    onClick={() => removeSignal(s.symbol)}
                    style={{
                      position:'absolute', top:8, right:8, zIndex:10,
                      width:20, height:20, borderRadius:4,
                      background:'var(--bg-elevated)', border:'1px solid var(--border)',
                      color:'var(--text-muted)', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:10, lineHeight:1,
                    }}
                  >✕</button>
                  <SignalCard
                    signal={s}
                    flash={false}
                    onTrade={handleTrade}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:50 }}>
          <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>
        </div>
      )}
    </AppShell>
  );
}
