// src/components/SignalCard.jsx
// RSI / SMA / BB / source badge / auto-trade buttons

import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { simAPI, manualTradeAPI } from '../services/api';

function ConfRing({ value = 0 }) {
  const pct  = Math.round(value * 100);
  const r    = 24, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct > 65 ? 'var(--green)' : pct > 35 ? 'var(--cyan)' : 'var(--amber)';
  return (
    <div style={{ position:'relative', width:60, height:60, flexShrink:0 }}>
      <svg width="60" height="60" style={{ transform:'rotate(-90deg)' }}>
        <circle cx="30" cy="30" r={r} fill="none" stroke="var(--border)" strokeWidth="3.5"/>
        <circle cx="30" cy="30" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition:'stroke-dasharray 0.4s ease' }}/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontSize:11, fontWeight:700, fontFamily:'var(--font-mono)', color }}>{pct}%</span>
        <span style={{ fontSize:8, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>CONF</span>
      </div>
    </div>
  );
}

function Pill({ label, value, color }) {
  return (
    <div style={{ flex:1, padding:'5px 0', textAlign:'center', background:'var(--bg-elevated)', borderRadius:6, border:'1px solid var(--border)' }}>
      <div style={{ fontSize:8, color:'var(--text-muted)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
      <div style={{ fontSize:10, fontWeight:700, fontFamily:'var(--font-mono)', color: color||'var(--text-primary)', marginTop:2 }}>{value??'—'}</div>
    </div>
  );
}

function SourceBadge({ source }) {
  const live = source === 'LIVE';
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:3,
      fontSize:8, fontFamily:'var(--font-mono)', fontWeight:700,
      padding:'2px 6px', borderRadius:4,
      background: live ? 'rgba(0,230,118,0.1)' : 'rgba(255,167,38,0.1)',
      border:     live ? '1px solid rgba(0,230,118,0.3)' : '1px solid rgba(255,167,38,0.3)',
      color:      live ? 'var(--green)' : 'var(--amber)',
    }}>
      {live ? '🟢' : '🟡'} {live ? 'LIVE' : 'SIM'}
    </span>
  );
}

export default function SignalCard({ signal: s, flash = false, onTrade }) {
  const [trading,  setTrading]  = useState(null);
  const [tradeMsg, setTradeMsg] = useState(null);
  if (!s) return null;

  const sig   = s.signal || 'HOLD';
  const src   = s.source || 'SIM';
  const rsi   = s.rsi   != null ? Number(s.rsi).toFixed(1)   : null;
  const sma20 = s.sma20  != null ? Number(s.sma20).toFixed(0) : null;
  const sma50 = s.sma50  != null ? Number(s.sma50).toFixed(0) : null;
  const bbU   = s.bbUpper  != null ? Number(s.bbUpper).toFixed(0)  : null;
  const bbL   = s.bbLower  != null ? Number(s.bbLower).toFixed(0)  : null;

  const sigColor = sig==='BUY' ? 'var(--green)' : sig==='SELL' ? 'var(--red)' : 'var(--amber)';
  const sigBg    = sig==='BUY' ? 'rgba(0,230,118,0.08)' : sig==='SELL' ? 'rgba(255,71,87,0.08)' : 'rgba(255,167,38,0.08)';
  const Icon     = sig==='BUY' ? TrendingUp : sig==='SELL' ? TrendingDown : Minus;

  const rsiColor = rsi!=null ? (Number(rsi)<30 ? 'var(--green)' : Number(rsi)>70 ? 'var(--red)' : 'var(--text-primary)') : 'var(--text-muted)';
  const maColor  = (sma20&&sma50) ? (Number(sma20)>Number(sma50) ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)';
  const maLabel  = (sma20&&sma50) ? (Number(sma20)>Number(sma50) ? '▲ Bull' : '▼ Bear') : '—';

  async function handleTrade(side) {
    if (trading) return;
    setTrading(side);
    setTradeMsg(null);
    try {
      await simAPI.start(1000000).catch(()=>{});  // init portfolio if not done
      await manualTradeAPI.place(s.symbol, side, 10);
      const msg = `${side} ×10 @ ₹${Number(s.currentPrice).toFixed(2)}`;
      setTradeMsg({ ok:true, text: msg });
      onTrade?.({ symbol:s.symbol, side, price:s.currentPrice, qty:10, signal:sig });
    } catch(err) {
      setTradeMsg({ ok:false, text: err.response?.data?.error || 'Order failed' });
    } finally {
      setTrading(null);
      setTimeout(()=>setTradeMsg(null), 3500);
    }
  }

  return (
    <div className={flash ? 'trade-flash' : ''} style={{
      background:'var(--bg-card)',
      border:`1px solid ${sig==='BUY'?'rgba(0,230,118,0.2)':sig==='SELL'?'rgba(255,71,87,0.2)':'var(--border)'}`,
      borderRadius:12, padding:'14px 16px',
      display:'flex', flexDirection:'column', gap:10,
      transition:'all 0.2s',
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)', letterSpacing:'0.02em' }}>{s.symbol}</div>
          <div style={{ fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-muted)', marginTop:2 }}>
            ₹{s.currentPrice!=null ? Number(s.currentPrice).toLocaleString('en-IN',{minimumFractionDigits:2}) : '—'}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <SourceBadge source={src} />
          {s.score!=null && (
            <span style={{ fontSize:8, fontFamily:'var(--font-mono)', fontWeight:700, padding:'2px 5px', borderRadius:4, background:'var(--bg-elevated)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>
              SCORE {s.score>0?'+':''}{s.score}
            </span>
          )}
        </div>
      </div>

      {/* Signal + ring */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, background:sigBg, color:sigColor, fontSize:14, fontWeight:700 }}>
          <Icon size={14}/> {sig}
        </div>
        <ConfRing value={s.confidence}/>
      </div>

      {/* Indicators row 1: RSI + MA */}
      <div style={{ display:'flex', gap:4 }}>
        <Pill label="RSI(14)"  value={rsi}    color={rsiColor}/>
        <Pill label="MA Cross" value={maLabel} color={maColor}/>
      </div>

      {/* Indicators row 2: SMA20 / SMA50 */}
      <div style={{ display:'flex', gap:4 }}>
        <Pill label="SMA20" value={sma20?`₹${sma20}`:null} color={maColor}/>
        <Pill label="SMA50" value={sma50?`₹${sma50}`:null} color={maColor}/>
      </div>

      {/* Indicators row 3: Bollinger Bands */}
      <div style={{ display:'flex', gap:4 }}>
        <Pill label="BB Upper" value={bbU?`₹${bbU}`:null} color="var(--red)"/>
        <Pill label="BB Lower" value={bbL?`₹${bbL}`:null} color="var(--green)"/>
      </div>

      {/* Component tags */}
      {s.components && Object.keys(s.components).length>0 && (
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          {Object.entries(s.components).map(([k,v])=>(
            <span key={k} style={{ fontSize:8, fontFamily:'var(--font-mono)', padding:'2px 5px', borderRadius:4, background:'var(--bg-elevated)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>
              {k.toUpperCase()}: {v}
            </span>
          ))}
        </div>
      )}

      {/* Auto-trade buttons */}
      <div style={{ display:'flex', gap:6 }}>
        {['BUY','SELL'].map(side=>{
          const active = sig===side;
          const color  = side==='BUY' ? 'var(--green)' : 'var(--red)';
          const bg     = side==='BUY' ? 'rgba(0,230,118,0.15)' : 'rgba(255,71,87,0.15)';
          const bdr    = side==='BUY' ? 'rgba(0,230,118,0.4)' : 'rgba(255,71,87,0.4)';
          const SideIcon = side==='BUY' ? TrendingUp : TrendingDown;
          return (
            <button key={side} onClick={()=>handleTrade(side)} disabled={!!trading}
              style={{
                flex:1, padding:'7px 0', borderRadius:7,
                fontSize:11, fontWeight:700, fontFamily:'var(--font-mono)',
                background: active ? bg : 'var(--bg-elevated)',
                border: active ? `1px solid ${bdr}` : '1px solid var(--border)',
                color: active ? color : 'var(--text-muted)',
                cursor: trading ? 'not-allowed' : 'pointer',
                opacity: (trading && trading!==side) ? 0.4 : 1,
                display:'flex', alignItems:'center', justifyContent:'center', gap:4,
                transition:'all 0.15s',
              }}>
              {trading===side ? <Activity size={10}/> : <SideIcon size={10}/>}
              {side}
            </button>
          );
        })}
      </div>

      {/* Trade feedback */}
      {tradeMsg && (
        <div style={{
          fontSize:9, fontFamily:'var(--font-mono)', textAlign:'center',
          padding:'4px 8px', borderRadius:5,
          background: tradeMsg.ok ? 'rgba(0,230,118,0.08)' : 'rgba(255,71,87,0.08)',
          color:      tradeMsg.ok ? 'var(--green)' : 'var(--red)',
          border:`1px solid ${tradeMsg.ok?'rgba(0,230,118,0.2)':'rgba(255,71,87,0.2)'}`,
        }}>
          {tradeMsg.text}
        </div>
      )}

      {/* Timestamp */}
      {s.timestamp && (
        <div style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--text-muted)', textAlign:'right' }}>
          {new Date(s.timestamp).toLocaleTimeString('en-IN',{hour12:false})}
        </div>
      )}
    </div>
  );
}
