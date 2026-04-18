// src/components/ThemeToggle.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Toggle button: 🌙 Dark ↔ ☀️ Light
// Uses CSS variables for styling so it automatically adapts to theme switches.
// ─────────────────────────────────────────────────────────────────────────────

import { Moon, Sun } from 'lucide-react';
import { useThemeContext } from '../context/ThemeContext';

export default function ThemeToggle({ compact = false }) {
  const { isDark, toggleTheme, theme } = useThemeContext();

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className="notransition"
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            compact ? 0 : 5,
        padding:        compact ? '5px' : '5px 10px',
        borderRadius:   8,
        border:         '1px solid var(--border)',
        background:     isDark ? 'var(--bg-elevated)' : 'var(--bg-card)',
        color:          isDark ? 'var(--amber)' : 'var(--cyan)',
        cursor:         'pointer',
        flexShrink:     0,
        fontFamily:     'var(--font-mono)',
        fontSize:       10,
        fontWeight:     700,
        letterSpacing:  '0.05em',
        // No transition on the button itself — avoids icon flash during theme change
        transition:     'border-color 150ms ease, box-shadow 150ms ease',
        boxShadow:      isDark
          ? 'inset 0 0 0 1px rgba(255,176,32,0.08)'
          : 'inset 0 0 0 1px rgba(0,136,204,0.08)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = isDark
          ? 'rgba(255,176,32,0.35)'
          : 'rgba(0,136,204,0.35)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      {isDark
        ? <Sun  size={12} strokeWidth={2} />
        : <Moon size={12} strokeWidth={2} />
      }
      {!compact && (
        <span style={{ userSelect: 'none' }}>
          {isDark ? 'Light' : 'Dark'}
        </span>
      )}
    </button>
  );
}
