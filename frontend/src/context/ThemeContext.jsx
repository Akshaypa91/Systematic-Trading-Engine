// src/context/ThemeContext.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Provides theme state + toggle to the entire app tree.
// Wrap at root level (App.jsx) so Navbar, Sidebar, and any page can access it.
//
// Usage:
//   import { useThemeContext } from '../context/ThemeContext';
//   const { theme, isDark, toggleTheme } = useThemeContext();
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';
import { useTheme } from '../hooks/useTheme';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const themeState = useTheme();
  return (
    <ThemeContext.Provider value={themeState}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider');
  return ctx;
}
