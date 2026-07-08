// src/components/AppShell.jsx — v4
// Desktop footer is now StatusBar (slim terminal status strip); BottomNav is
// mobile-only. Global "g then letter" navigation + "?" help are wired here
// so they work app-wide regardless of which page is mounted.
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar          from './Navbar';
import Sidebar         from './Sidebar';
import BottomNav       from './BottomNav';
import StatusBar       from './StatusBar';
import ShortcutsModal  from './ShortcutsModal';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';

export default function AppShell({ children }) {
  const [menuOpen, setMenuOpen]           = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const navigate = useNavigate();

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useGlobalShortcuts({ onOpenHelp: openShortcuts, navigate });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <Navbar onMenuToggle={() => setMenuOpen(o => !o)} menuOpen={menuOpen} />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main content — offset by sidebar on desktop, status bar at bottom */}
      <div
        style={{
          paddingTop:  'var(--navbar-h)',
          paddingLeft: 'var(--sidebar-w)',
          minHeight:   '100vh',
          transition:  'padding-left 0.25s',
        }}
        className="main-content-area"
      >
        {children}
      </div>

      {/* Desktop: slim status bar (≥1024px). Mobile: floating nav (<1024px). */}
      <StatusBar onOpenShortcuts={openShortcuts} />
      <BottomNav />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
