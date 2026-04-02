export default function MetricsCard({ label, value, sub, color = 'cyan', icon: Icon, trend }) {
  const colors = {
    cyan:   { accent: 'var(--accent-cyan)',  bg: 'rgba(0,212,255,0.06)',  border: 'rgba(0,212,255,0.15)' },
    green:  { accent: 'var(--accent-green)', bg: 'rgba(0,230,118,0.06)',  border: 'rgba(0,230,118,0.15)' },
    red:    { accent: 'var(--accent-red)',   bg: 'rgba(255,71,87,0.06)',   border: 'rgba(255,71,87,0.15)' },
    amber:  { accent: 'var(--accent-amber)', bg: 'rgba(255,167,38,0.06)', border: 'rgba(255,167,38,0.15)' },
    purple: { accent: '#7c4dff',             bg: 'rgba(124,77,255,0.06)', border: 'rgba(124,77,255,0.15)' },
  };
  const c = colors[color] || colors.cyan;

  return (
    <div
      className="card-hover rounded-xl p-5 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid var(--border)`,
      }}
    >
      {/* Subtle corner accent */}
      <div className="absolute top-0 right-0 w-20 h-20 opacity-10 rounded-bl-full"
        style={{ background: `radial-gradient(circle, ${c.accent}, transparent 70%)` }} />

      <div className="flex items-center justify-between">
        <span className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
        {Icon && (
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}>
            <Icon size={13} style={{ color: c.accent }} />
          </div>
        )}
      </div>

      <div>
        <div className="text-2xl font-bold count-up" style={{ color: c.accent, fontVariantNumeric: 'tabular-nums' }}>
          {value ?? '—'}
        </div>
        {sub && (
          <div className="text-xs font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
            {sub}
          </div>
        )}
      </div>

      {trend !== undefined && (
        <div className="flex items-center gap-1 text-xs font-mono">
          <span style={{ color: trend >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}
