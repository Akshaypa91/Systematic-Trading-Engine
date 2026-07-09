import { RefreshCw } from 'lucide-react';

/**
 * Button — the single button primitive for SYSTRA.
 * Wraps the existing `.btn` token classes so every button in the app shares
 * one source of truth for padding, focus ring, disabled + active states.
 *
 * Props:
 *   variant: 'cyan' | 'green' | 'red' | 'amber' | 'ghost'  (default 'ghost')
 *   size:    'sm' | 'md'                                    (default 'md')
 *   loading: boolean — shows a spinner and disables the button
 *   icon:    lucide icon component (optional leading icon)
 *   as:      render as a different element (e.g. 'a')       (default 'button')
 */
const VARIANTS = {
  primary: 'btn-solid', // brand-gradient CTA — use once per screen
  cyan: 'btn-cyan',
  green: 'btn-green',
  red: 'btn-red',
  amber: 'btn-amber',
  ghost: 'btn-ghost',
};

export default function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  icon: Icon,
  as: Tag = 'button',
  className = '',
  children,
  disabled,
  style,
  ...rest
}) {
  const sizeStyle = size === 'sm' ? { padding: '4px 10px', fontSize: 12 } : undefined;
  const iconSize = size === 'sm' ? 11 : 13;

  return (
    <Tag
      className={`btn ${VARIANTS[variant] || VARIANTS.ghost} ${className}`.trim()}
      disabled={Tag === 'button' ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      style={{ ...sizeStyle, ...style }}
      {...rest}
    >
      {loading ? (
        <RefreshCw size={iconSize} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden="true" />
      )}
      {children}
    </Tag>
  );
}
