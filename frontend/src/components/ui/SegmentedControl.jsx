/**
 * SegmentedControl — compact switcher for timeframes / filters.
 * options: array of string | { label, value }. Controlled via value/onChange.
 */
export default function SegmentedControl({ options = [], value, onChange, ariaLabel, className = '', style }) {
  const norm = options.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));
  return (
    <div className={`seg ${className}`.trim()} role="tablist" aria-label={ariaLabel} style={style}>
      {norm.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-active={value === o.value ? 'true' : 'false'}
          onClick={() => onChange?.(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
