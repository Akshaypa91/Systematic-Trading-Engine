// src/components/AppShell.jsx — v3
import { useState } from 'react';
import Navbar   from './Navbar';
import Sidebar  from './Sidebar';
import BottomNav from './BottomNav';

export default function AppShell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <Navbar onMenuToggle={() => setMenuOpen(o => !o)} menuOpen={menuOpen} />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Main content — offset by sidebar on desktop */}
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

      {/* Mobile bottom nav — only visible <1024px via CSS */}
      <BottomNav />
    </div>
  );
}
