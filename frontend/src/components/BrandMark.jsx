// src/components/BrandMark.jsx
// SYSTRA brand mark — a gradient tile with three ascending candles and a
// breakout trend arrow. Token-driven (cyan→purple brand gradient) so it
// adapts to both themes. Used in the navbar; sized via the `size` prop.
import { useId } from 'react';

export default function BrandMark({ size = 26, radius = 8 }) {
  const uid = useId().replace(/:/g, '');
  const g = `bm-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cyan)" />
          <stop offset="100%" stopColor="var(--purple)" />
        </linearGradient>
      </defs>

      {/* Gradient tile */}
      <rect width="32" height="32" rx={radius} fill={`url(#${g})`} />
      {/* Inner top highlight for a machined feel */}
      <rect x="1" y="1" width="30" height="30" rx={radius - 1} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.75" />

      {/* Ascending candles (white, translucent wicks) */}
      <line x1="9"  y1="14" x2="9"  y2="27" stroke="rgba(255,255,255,0.55)" strokeWidth="1.1" strokeLinecap="round" />
      <rect x="6.8" y="16.5" width="4.4" height="7.5" rx="1.1" fill="rgba(255,255,255,0.92)" />

      <line x1="16" y1="10" x2="16" y2="23" stroke="rgba(255,255,255,0.55)" strokeWidth="1.1" strokeLinecap="round" />
      <rect x="13.8" y="12.5" width="4.4" height="7.5" rx="1.1" fill="rgba(255,255,255,0.92)" />

      <line x1="23" y1="5" x2="23" y2="18" stroke="rgba(255,255,255,0.55)" strokeWidth="1.1" strokeLinecap="round" />
      <rect x="20.8" y="7.5" width="4.4" height="7.5" rx="1.1" fill="rgba(255,255,255,0.92)" />

      {/* Breakout arrow sweeping over the candles */}
      <path
        d="M5.5 26.5 L13 19.5 L17.5 22.5 L26 11"
        fill="none"
        stroke="#0B1220"
        strokeOpacity="0.55"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 26.5 L13 19.5 L17.5 22.5 L26 11"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Arrowhead */}
      <path d="M26.8 15.2 L26.8 9.8 L21.6 9.8" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" transform="rotate(8 26.8 9.8)" />
    </svg>
  );
}
