/**
 * PageHeader — the page title / mono-subtitle / right-side action row that
 * opens every page (Dashboard, Signals, Backtest, ...). Standardizes the
 * heading hierarchy so every page uses the same size, weight and spacing.
 */
export default function PageHeader({ title, subtitle, action, style }) {
  return (
    <div
      className="ui-between ui-wrap"
      style={{ marginBottom: 24, gap: 12, alignItems: 'flex-start', ...style }}
    >
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {title}
        </h1>
        {subtitle && (
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="ui-hstack" style={{ gap: 8 }}>{action}</div>}
    </div>
  );
}
