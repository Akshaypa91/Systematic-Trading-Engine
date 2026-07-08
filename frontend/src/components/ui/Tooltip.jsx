/**
 * Tooltip — hover/focus label. Wraps its child; content shown above on hover.
 * Keyboard-accessible (shows on focus-within). Pure CSS transitions.
 */
export default function Tooltip({ label, children, className = '' }) {
  return (
    <span className={`ui-tip-wrap ${className}`.trim()}>
      {children}
      <span className="ui-tip" role="tooltip">{label}</span>
    </span>
  );
}
