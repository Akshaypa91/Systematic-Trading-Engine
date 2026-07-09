import Skeleton from './Skeleton';

/**
 * Metric — a KPI tile (Total Return, Win Rate, Sharpe, etc).
 * Successor to components/MetricsCard.jsx. Key improvement: the accent tint,
 * icon chip and glow are all derived from the live theme token via CSS
 * color-mix, so they stay correct in both dark and light themes and no longer
 * drift from hard-coded rgba() literals.
 *
 * color: 'cyan' | 'green' | 'red' | 'amber' | 'purple'
 */
const ACCENT_VAR = {
  cyan: 'var(--cyan)',
  green: 'var(--green)',
  red: 'var(--red)',
  amber: 'var(--amber)',
  purple: 'var(--purple)',
};

export default function Metric({ label, value, sub, color = 'cyan', icon: Icon, trend, loading }) {
  const accent = ACCENT_VAR[color] || ACCENT_VAR.cyan;
  // Placeholder state (no data yet): render the dash muted, not in the accent
  // color, so empty tiles don't read as colored bugs.
  const isEmpty = value == null || value === '—' || value === '';

  if (loading) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <Skeleton w={80} h={10} style={{ marginBottom: 12 }} />
        <Skeleton w={120} h={24} style={{ marginBottom: 8 }} />
        <Skeleton w={100} h={9} />
      </div>
    );
  }

  return (
    <div
      className="card fade-up"
      style={{ padding: 20, position: 'relative', overflow: 'hidden', '--metric-accent': accent }}
    >
      <div className="ui-metric-top" aria-hidden="true" />
      <div className="ui-metric-glow" aria-hidden="true" />

      <div className="ui-between" style={{ marginBottom: 12 }}>
        <span className="section-label">{label}</span>
        {Icon && (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'color-mix(in srgb, var(--metric-accent) 9%, transparent)',
              border: '1px solid color-mix(in srgb, var(--metric-accent) 20%, transparent)',
            }}
          >
            <Icon size={13} style={{ color: accent }} aria-hidden="true" />
          </div>
        )}
      </div>

      <div
        className="num-flip"
        style={{
          fontSize: 22, fontWeight: 700,
          color: isEmpty ? 'var(--text-dim)' : accent,
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}
      >
        {isEmpty ? '—' : value}
      </div>

      {sub && (
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
          {sub}
        </div>
      )}

      {trend !== undefined && trend !== null && (
        <div
          className="font-mono"
          style={{ fontSize: 11, marginTop: 6, color: trend >= 0 ? 'var(--green)' : 'var(--red)' }}
        >
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)}%
        </div>
      )}
    </div>
  );
}
