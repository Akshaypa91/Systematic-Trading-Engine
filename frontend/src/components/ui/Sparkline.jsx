/**
 * Sparkline — tiny dependency-free inline SVG trend line.
 * Used in hero tiles, watchlist rows and movers where a full recharts chart
 * would be overkill. Auto-colors by net direction unless `color` is given.
 */
import { useId } from 'react';

export default function Sparkline({
  data = [],
  width = 72,
  height = 24,
  color,
  fill = true,
  strokeWidth = 1.5,
}) {
  const uid = useId();
  const pts = (data || []).filter((v) => Number.isFinite(Number(v))).map(Number);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = width / (pts.length - 1);
  const y = (v) => height - ((v - min) / span) * (height - 2) - 1;

  const up = pts[pts.length - 1] >= pts[0];
  const stroke = color || (up ? 'var(--green)' : 'var(--red)');

  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spk-${uid.replace(/:/g, '')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} stroke="none" />
        </>
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
