/**
 * EmptyState — consistent "nothing here yet" panel.
 * Standardizes the dashed-border empty panels that were hand-built per page.
 */
export default function EmptyState({ icon: Icon, title, description, action, style }) {
  return (
    <div className="ui-empty" style={style}>
      {Icon && (
        <div className="ui-empty-icon">
          <Icon size={22} aria-hidden="true" />
        </div>
      )}
      {title && (
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600, margin: '0 0 6px' }}>{title}</p>
      )}
      {description && (
        <p className="font-mono" style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
