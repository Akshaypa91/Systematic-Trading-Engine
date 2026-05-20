// src/components/BottomNav.jsx
// Shows on mobile (<768px) — fixed bottom bar with 5 main nav items
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Radio, TrendingUp, Search } from 'lucide-react';

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: 'Home',     end: true },
  { to: '/signals',  icon: Radio,           label: 'Signals' },
  { to: '/trade',    icon: ArrowLeftRight,  label: 'Trade' },
  { to: '/screener', icon: Search,          label: 'Screen' },
  { to: '/backtest', icon: TrendingUp,      label: 'Backtest' },
];

export default function BottomNav() {
  return (
    <nav
      className="lg:hidden"
      style={{
        position:   'fixed',
        bottom:     0,
        left:       0,
        right:      0,
        zIndex:     50,
        background: 'var(--bg-surface)',
        borderTop:  '1px solid var(--border)',
        display:    'flex',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {NAV.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={{ flex: 1 }}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
              isActive ? 'text-[var(--cyan)]' : 'text-[var(--text-muted)]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <div style={{
                padding:      '4px 14px',
                borderRadius: 99,
                background:   isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
                transition:   'background 0.15s',
              }}>
                <Icon size={18} strokeWidth={isActive ? 2.2 : 1.75} />
              </div>
              <span style={{
                fontSize:   9,
                fontWeight: isActive ? 700 : 400,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
              }}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}