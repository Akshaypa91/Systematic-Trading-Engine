/**
 * Skeleton — loading placeholder. Thin wrapper over the `.skeleton` shimmer
 * class so widths/heights are passed as props instead of repeated inline
 * style objects.
 */
export default function Skeleton({ w, h = 12, radius, className = '', style }) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{
        width: w,
        height: h,
        ...(radius !== undefined ? { borderRadius: radius } : null),
        ...style,
      }}
      aria-hidden="true"
    />
  );
}
