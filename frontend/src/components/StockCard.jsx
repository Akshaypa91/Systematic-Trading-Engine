import { TrendingUp, TrendingDown, Minus, RefreshCw, Clock, Activity, BarChart2 } from 'lucide-react';

const SIG = {
  BUY:  { color: 'var(--green)', bg: 'color-mix(in srgb, var(--green) 10%, transparent)', border: 'color-mix(in srgb, var(--green) 30%, transparent)', icon: TrendingUp  },
  SELL: { color: 'var(--red)',   bg: 'color-mix(in srgb, var(--red) 10%, transparent)', border: 'color-mix(in srgb, var(--red) 30%, transparent)', icon: TrendingDown },
  HOLD: { color: 'var(--amber)', bg: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: 'color-mix(in srgb, var(--amber) 30%, transparent)', icon: Minus       },
};

function Pill({ label, value, color }) {
  return (
    <div style={{
      padding: '8px 12px', background: 'var(--bg-base)',
      border: '1px solid var(--border)', borderRadius: 8,
    }}>
      <div className="section-label" style={{ marginBottom: 4 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: color || 'var(--text-primary)' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function RSIBar({ value }) {
  if (value == null) return null;
  const pct   = Math.min(Math.max(value, 0), 100);
  const color = value >= 70 ? 'var(--red)' : value <= 30 ? 'var(--green)' : 'var(--cyan)';
  const zone  = value >= 70 ? 'Overbought' : value <= 30 ? 'Oversold' : 'Neutral';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="section-label">RSI (14)</span>
        <span className="font-mono" style={{ fontSize: 11, color }}>{value.toFixed(1)} · {zone}</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-base)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '30%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ position: 'absolute', left: '70%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{
          height: '100%', width: `${pct}%`, background: color, borderRadius: 2,
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
    </div>
  );
}

function ConfBar({ value }) {
  if (value == null) return null;
  const pct = Math.min(Math.max(value * 100, 0), 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="section-label">Confidence</span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="conf-track">
        <div className="conf-fill" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--cyan), var(--purple))' }} />
      </div>
    </div>
  );
}

export default function StockCard({ data, loading, onRefresh }) {
  if (loading) {
    return (
      <div className="card fade-in" style={{ padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="skeleton" style={{ width: 160, height: 22 }} />
          <div className="skeleton" style={{ width: 220, height: 32 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[0,1,2].map(i => <div key={i} className="skeleton" style={{ height: 54 }} />)}
          </div>
          <div className="skeleton" style={{ height: 4 }} />
          <div className="skeleton" style={{ height: 4 }} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const signal = (data.signal || 'HOLD').toUpperCase();
  const cfg    = SIG[signal] || SIG.HOLD;
  const Icon   = cfg.icon;

  const price     = data.price ?? data.lastPrice;
  const rsi       = data.rsi ?? data.rsiValue;
  const conf      = data.confidence;
  const _rawTrend = data.trend ?? data.regime;
  const trend     = typeof _rawTrend === 'string' ? _rawTrend
                  : typeof _rawTrend === 'object' && _rawTrend !== null ? (_rawTrend.type ?? _rawTrend.label ?? JSON.stringify(_rawTrend))
                  : null;
  const maFast    = data.maFast;
  const maSlow    = data.maSlow;
  const zScore    = data.zScore;
  const source    = data.source;
  const fetchedAt = data.fetchedAt ?? data.timestamp;
  // Any non-simulated source counts as a live feed (UPSTOX, LIVE_NSE, API, …).
  const isLiveSource = source != null && !['SIM', 'SIMULATION'].includes(String(source).toUpperCase());

  return (
    <div className="card fade-up" style={{
      padding: 24, position: 'relative', overflow: 'hidden',
      borderColor: cfg.border,
    }}>
      {/* Top accent stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${cfg.color}70, transparent)`,
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="font-mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
              {data.symbol}
            </span>
            {source && (
              <span className="font-mono" style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.08em',
                background: isLiveSource ? 'color-mix(in srgb, var(--green) 10%, transparent)' : 'color-mix(in srgb, var(--amber) 10%, transparent)',
                border: `1px solid ${isLiveSource ? 'color-mix(in srgb, var(--green) 25%, transparent)' : 'color-mix(in srgb, var(--amber) 25%, transparent)'}`,
                color: isLiveSource ? 'var(--green)' : 'var(--amber)',
              }}>
                {isLiveSource ? '● LIVE' : '◌ SIM'}
              </span>
            )}
          </div>
          {price != null && (
            <div className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>
              ₹{Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
          {fetchedAt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <Clock size={10} style={{ color: 'var(--text-muted)' }} />
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {new Date(fetchedAt).toLocaleTimeString('en-IN', { hour12: false })}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {/* Signal badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '8px 14px', borderRadius: 8,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
          }}>
            <Icon size={14} style={{ color: cfg.color }} strokeWidth={2.5} />
            <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: cfg.color, letterSpacing: '0.08em' }}>
              {signal}
            </span>
          </div>

          {trend && typeof trend === 'string' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 6,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            }}>
              {trend.includes('TREND') || trend.includes('BULL') || trend.includes('BEAR')
                ? <Activity size={10} style={{ color: 'var(--cyan)' }} />
                : <BarChart2 size={10} style={{ color: 'var(--amber)' }} />
              }
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{trend}</span>
            </div>
          )}

          {onRefresh && (
            <button onClick={onRefresh} className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }}>
              <RefreshCw size={10} />Refresh
            </button>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
        <Pill label="RSI" value={rsi != null ? rsi.toFixed(1) : null}
          color={rsi >= 70 ? 'var(--red)' : rsi <= 30 ? 'var(--green)' : 'var(--text-primary)'} />
        <Pill label="MA Fast" value={maFast != null ? `₹${Number(maFast).toFixed(0)}` : null} />
        <Pill label="MA Slow"  value={maSlow != null ? `₹${Number(maSlow).toFixed(0)}` : null} />
        {zScore != null && (
          <Pill label="Z-Score" value={zScore.toFixed(3)}
            color={Math.abs(zScore) > 2 ? 'var(--amber)' : 'var(--text-primary)'} />
        )}
        {conf != null && (
          <Pill label="Confidence" value={`${(conf * 100).toFixed(1)}%`} color="var(--cyan)" />
        )}
      </div>

      {/* Progress bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <RSIBar value={rsi} />
        <ConfBar value={conf} />
      </div>
    </div>
  );
}
