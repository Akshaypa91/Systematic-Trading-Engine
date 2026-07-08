/**
 * Card + CardHeader — surface primitives.
 * Card wraps the existing `.card` token class and standardizes padding so
 * pages stop hand-writing `style={{ padding: 20 }}` on every panel.
 *
 * CardHeader renders the recurring "section label + optional right-side meta"
 * row seen across Dashboard, Signals, Backtest, etc.
 */
export function Card({
  padding = 20,
  interactive = false,
  className = '',
  as = 'div',
  style,
  children,
  ...rest
}) {
  const Tag = as;
  return (
    <Tag
      className={`card ${className}`.trim()}
      style={{ padding, ...(interactive ? { cursor: 'pointer' } : null), ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, sub, action, style }) {
  return (
    <div className="ui-between" style={{ marginBottom: 16, gap: 12, ...style }}>
      <div className="ui-grow">
        <div className="section-label">{title}</div>
        {sub && (
          <p className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            {sub}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export default Card;
