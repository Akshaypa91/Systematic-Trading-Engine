/**
 * Chip — a compact selectable token (quick-select symbols, quick-add, filters).
 * Replaces three near-identical hand-rolled inline-styled buttons in
 * Dashboard and Signals. `active` drives the accent state via the .ui-chip
 * [data-active] token styling.
 */
export default function Chip({ active = false, className = '', children, style, ...rest }) {
  return (
    <button
      type="button"
      className={`ui-chip ${className}`.trim()}
      data-active={active ? 'true' : 'false'}
      aria-pressed={active}
      style={style}
      {...rest}
    >
      {children}
    </button>
  );
}
