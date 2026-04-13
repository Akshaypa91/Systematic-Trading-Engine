import { TrendingUp, TrendingDown, Minus, Activity, BarChart2, Zap, RefreshCw, Clock } from 'lucide-react';

const SIGNAL_CONFIG = {
  BUY:  { color: 'var(--green)',  bg: 'rgba(0,229,160,0.10)',  border: 'rgba(0,229,160,0.30)',  icon: TrendingUp,   glow: 'var(--glow-green)' },
  SELL: { color: 'var(--red)',    bg: 'rgba(255,77,106,0.10)', border: 'rgba(255,77,106,0.30)', icon: TrendingDown, glow: 'var(--glow-red)'   },
  HOLD: { color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', icon: Minus, glow: 'none' },
};

function StatPill({ label, value, color }) {
  return (
    <div style={{
      padding: '8px 14px',
      background: 'var(--bg-base)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span className="section-label">{label}</span>
      <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--text-primary)' }}>
        {value ?? '—'}
      </span>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="section-label">RSI (14)</span>
        <span className="font-mono" style={{ fontSize: 11, color }}>
          {value.toFixed(1)} · {zone}
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
        {/* Zone markers */}
        <div style={{ position: 'absolute', left: '30%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', left: '70%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.08)' }} />
        {/* Fill */}
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 2,
          background: color,
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: `0 0 8px ${color}40`,
        }} />
      </div>
    </div>
  );
}

function ConfidenceBar({ value }) {
  if (value == null) return null;
  const pct = Math.min(Math.max(value * 100, 0), 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="section-label">Signal Confidence</span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 2,
          background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
    </div>
  );
}

export default function StockCard({ data, loading, onRefresh }) {
  // Loading skeleton
  if (loading) {
    return (
      <div className="card fade-in" style={{ padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[180, 120, 60].map((w, i) => (
            <div key={i} style={{
              height: i === 0 ? 28 : 16, width: `${w}px`, borderRadius: 6,
              background: 'linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-hover) 50%, var(--bg-elevated) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s infinite',
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const signal = (data.signal || 'HOLD').toUpperCase();
  const cfg    = SIGNAL_CONFIG[signal] || SIGNAL_CONFIG.HOLD;
  const Icon   = cfg.icon;

  const price      = data.price ?? data.lastPrice ?? data.data?.price ?? data.data?.lastPrice;
  const rsi        = data.rsi ?? data.indicators?.rsi ?? data.rsiValue;
  const confidence = data.confidence;
  const trend      = data.trend ?? data.regime;
  const symbol     = data.symbol;
  const maFast     = data.maFast ?? data.indicators?.maFast;
  const maSlow     = data.maSlow ?? data.indicators?.maSlow;
  const zScore     = data.zScore ?? data.indicators?.zScore;
  const source     = data.source;
  const fetchedAt  = data.fetchedAt ?? data.timestamp;

  return (
    <div className="card fade-up" style={{
      padding: 24, position: 'relative', overflow: 'hidden',
      borderColor: cfg.border,
      boxShadow: `inset 0 0 0 1px ${cfg.border}`,
    }}>
      {/* Ambient glow strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${cfg.color}80, transparent)`,
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
              {symbol}
            </span>
            {source && (
              <span className="font-mono" style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 4,
                background: source === 'API' ? 'rgba(0,229,160,0.10)' : 'rgba(255,176,32,0.10)',
                border: `1px solid ${source === 'API' ? 'rgba(0,229,160,0.25)' : 'rgba(255,176,32,0.25)'}`,
                color: source === 'API' ? 'var(--green)' : 'var(--amber)',
                letterSpacing: '0.08em',
              }}>
                {source === 'API' ? '● LIVE' : '◌ SIM'}
              </span>
            )}
          </div>

          {price != null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="font-mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                ₹{Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {fetchedAt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Clock size={10} style={{ color: 'var(--text-muted)' }} />
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {new Date(fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {/* Signal badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '8px 16px', borderRadius: 8,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
            boxShadow: cfg.glow,
          }}>
            <Icon size={14} style={{ color: cfg.color }} strokeWidth={2.5} />
            <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: cfg.color, letterSpacing: '0.08em' }}>
              {signal}
            </span>
          </div>

          {/* Trend badge */}
          {trend && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 6,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            }}>
              {trend === 'TRENDING' || trend === 'BULL' || trend === 'BEAR'
                ? <Activity size={11} style={{ color: 'var(--cyan)' }} />
                : <BarChart2 size={11} style={{ color: 'var(--amber)' }} />
              }
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
                {trend}
              </span>
            </div>
          )}

          {onRefresh && (
            <button onClick={onRefresh} className="btn btn-ghost"
              style={{ padding: '4px 8px', fontSize: 10 }}>
              <RefreshCw size={11} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatPill label="RSI" value={rsi != null ? rsi.toFixed(1) : null}
          color={rsi >= 70 ? 'var(--red)' : rsi <= 30 ? 'var(--green)' : 'var(--text-primary)'} />
        <StatPill label="MA Fast" value={maFast != null ? `₹${Number(maFast).toFixed(2)}` : null} />
        <StatPill label="MA Slow"  value={maSlow != null ? `₹${Number(maSlow).toFixed(2)}` : null} />
        {zScore != null && (
          <StatPill label="Z-Score" value={zScore.toFixed(3)}
            color={Math.abs(zScore) > 2 ? 'var(--amber)' : 'var(--text-primary)'} />
        )}
        {confidence != null && (
          <StatPill label="Confidence" value={`${(confidence * 100).toFixed(1)}%`}
            color="var(--cyan)" />
        )}
      </div>

      {/* Progress bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <RSIBar value={rsi} />
        <ConfidenceBar value={confidence} />
      </div>
    </div>
  );
}