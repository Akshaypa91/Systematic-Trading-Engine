import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

function ConfBar({ value = 0 }) {
  const pct   = Math.round(value * 100);
  const color = pct > 65 ? 'var(--green)' : pct > 40 ? 'var(--amber)' : 'var(--red)';
  return (
    <div>
      <div className="conf-track">
        <div className="conf-fill" style={{ width:`${pct}%`, background:color }} />
      </div>
      <div className="flex justify-between" style={{ marginTop:3 }}>
        <span className="font-mono" style={{ fontSize:9, color:'var(--text-muted)' }}>Confidence</span>
        <span className="font-mono" style={{ fontSize:9, color }}>{pct}%</span>
      </div>
    </div>
  );
}

export default function SignalCard({ signal: s, flash = false }) {
  if (!s) return null;
  const sig = s.signal || 'HOLD';
  const badgeClass = sig === 'BUY' ? 'badge badge-buy' : sig === 'SELL' ? 'badge badge-sell' : 'badge badge-hold';
  const Icon = sig === 'BUY' ? TrendingUp : sig === 'SELL' ? TrendingDown : Minus;

  return (
    <div className={`card-elevated fade-in ${flash ? 'trade-flash' : ''}`}
      style={{ padding:'12px 14px', transition:'all 0.2s' }}>
      <div className="flex items-start justify-between" style={{ marginBottom:8 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', letterSpacing:'0.02em' }}>{s.symbol}</div>
          <div className="font-mono" style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
            ₹{s.currentPrice?.toLocaleString('en-IN') || '—'}
          </div>
        </div>
        <span className={badgeClass}><Icon size={9} />{sig}</span>
      </div>

      <ConfBar value={s.confidence} />

      <div className="flex items-center justify-between" style={{ marginTop:8 }}>
        <span className="font-mono" style={{ fontSize:9, color:'var(--text-muted)' }}>
          {s.regime || '—'} · RSI {s.rsi ?? '—'}
        </span>
        <span className="font-mono" style={{ fontSize:9, color:'var(--text-muted)' }}>
          {s.timestamp ? new Date(s.timestamp).toLocaleTimeString('en-IN', { hour12:false }) : ''}
        </span>
      </div>
    </div>
  );
}
