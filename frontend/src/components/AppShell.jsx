// src/components/AppShell.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Shared layout wrapper — manages mobile menu state, wires Navbar + Sidebar.
// Wrap every protected page with <AppShell> instead of using Navbar+Sidebar directly.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import Navbar  from './Navbar';
import Sidebar from './Sidebar';

export default function AppShell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="page-shell">
      <Navbar onMenuToggle={() => setMenuOpen(o => !o)} menuOpen={menuOpen} />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      {children}
    </div>
  );
}