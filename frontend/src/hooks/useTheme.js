// src/hooks/useTheme.js
// ─────────────────────────────────────────────────────────────────────────────
// Theme hook — manages dark/light toggle with localStorage persistence.
//
// STRATEGY
// ────────
// The app uses CSS custom properties (var(--bg-base) etc.) for all styling.
// Rather than adding Tailwind dark: prefixes to every class, we:
//   1. Define a [data-theme="light"] block in index.css that overrides all vars
//   2. Toggle data-theme="light" | "dark" on <html>
//   3. All components update automatically — zero component changes needed
//
// This is more maintainable than Tailwind dark: classes for an app that
// already has a complete CSS variable system.
//
// USAGE
//   const { theme, toggleTheme, isDark } = useTheme();
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY  = 'systra-theme';
const VALID_THEMES = ['dark', 'light'];

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (VALID_THEMES.includes(saved)) return saved;
  } catch (_err) {
    // localStorage can be unavailable in restricted browser contexts.
  }
  // Light-first, like every Indian broker app (Groww/Upstox/Tickertape open
  // light regardless of OS preference). A user who wants dark toggles once and
  // the choice persists; OS-dark users landing on a dark trading terminal on
  // first visit read it as "developer tool", not "product".
  return 'light';
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Keep a data-color-scheme for any third-party libs that read it
  root.setAttribute('data-color-scheme', theme);
  // Meta theme-color for mobile browsers
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#060a12' : '#f0f4fa');
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  // Apply to DOM on mount and on change
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_err) {
      // Theme persistence is best effort.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const setDark  = useCallback(() => setTheme('dark'),  []);
  const setLight = useCallback(() => setTheme('light'), []);

  return {
    theme,
    isDark:      theme === 'dark',
    isLight:     theme === 'light',
    toggleTheme,
    setDark,
    setLight,
  };
}
