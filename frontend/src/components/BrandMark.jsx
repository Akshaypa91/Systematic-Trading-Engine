// src/components/BrandMark.jsx
// SYSTRA brand mark — deep-navy chart tile with ascending green candles and a
// bullish breakout arrow. Fixed colors (a logo shouldn't invert with theme);
// the navy tile + market-green candles read as a trading chart at any size.
import { useId } from 'react';

const NAVY = '#0C1322';
const GREEN = '#2FBF63';
const GREEN_BRIGHT = '#52E087';

export default function BrandMark({ size = 26, radius = 8 }) {
  const uid = useId().replace(/:/g, '');
  const g = `bm-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#111B30" />
          <stop offset="100%" stopColor={NAVY} />
        </linearGradient>
      </defs>

      {/* Chart tile */}
      <rect width="32" height="32" rx={radius} fill={`url(#${g})`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx={radius - 0.5} fill="none" stroke="rgba(82,224,135,0.35)" strokeWidth="1" />
      {/* Faint grid line */}
      <line x1="4" y1="21" x2="28" y2="21" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />
      <line x1="4" y1="12" x2="28" y2="12" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />

      {/* Ascending green candles */}
      <line x1="9" y1="13.5" x2="9" y2="27.5" stroke={GREEN} strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="6.7" y="16.5" width="4.6" height="8" rx="1.2" fill={GREEN} />

      <line x1="16" y1="9" x2="16" y2="23.5" stroke={GREEN} strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="13.7" y="12" width="4.6" height="8" rx="1.2" fill={GREEN} />

      <line x1="23" y1="4.5" x2="23" y2="19" stroke={GREEN_BRIGHT} strokeOpacity="0.8" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="20.7" y="7.5" width="4.6" height="8" rx="1.2" fill={GREEN_BRIGHT} />

      {/* Bullish breakout arrow */}
      <path
        d="M5.5 26.5 L13 20 L17.5 22.5 L26.5 10.5"
        fill="none"
        stroke={NAVY}
        strokeOpacity="0.9"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 26.5 L13 20 L17.5 22.5 L26.5 10.5"
        fill="none"
        stroke={GREEN_BRIGHT}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M27 15 L27 10 L22.2 10" fill="none" stroke={GREEN_BRIGHT} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" transform="rotate(10 27 10)" />
    </svg>
  );
}
