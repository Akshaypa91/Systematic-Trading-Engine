/**
 * Badge — signal / status pill.
 * `tone` maps to the existing `.badge-*` token classes for BUY/SELL/HOLD,
 * plus a neutral variant built from theme tokens.
 */
const TONE_CLASS = {
  buy: 'badge-buy',
  sell: 'badge-sell',
  hold: 'badge-hold',
};

export default function Badge({ tone = 'neutral', icon: Icon, className = '', children, style, ...rest }) {
  const toneClass = TONE_CLASS[tone];
  const neutralStyle = toneClass
    ? undefined
    : {
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
      };
  return (
    <span className={`badge ${toneClass || ''} ${className}`.trim()} style={{ ...neutralStyle, ...style }} {...rest}>
      {Icon && <Icon size={11} aria-hidden="true" />}
      {children}
    </span>
  );
}
