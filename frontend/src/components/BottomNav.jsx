// src/components/BottomNav.jsx
// Mobile-only (<1024px) floating glass nav. Desktop uses StatusBar.jsx instead
// — see AppShell.jsx. The badge on "Trade" reflects real open-position count
// from the live WS portfolio feed, not a placeholder.
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Radio, BookOpen, Search } from 'lucide-react';
import { useWS } from '../context/WSContext';

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: 'Home',    end: true },
  { to: '/signals',  icon: Radio,           label: 'Signals' },
  { to: '/trade',    icon: ArrowLeftRight,  label: 'Trade' },
  { to: '/journal',  icon: BookOpen,        label: 'Journal' },
  { to: '/screener', icon: Search,          label: 'Screen' },
];

export default function BottomNav() {
  const { portfolio } = useWS();
  const openPositions = portfolio?.openPositionCount || 0;

  return (
    <div className="mobile-nav-wrap">
      <nav className="mobile-nav" aria-label="Primary">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <div className="mnav-icon-wrap">
                  <Icon size={18} strokeWidth={isActive ? 2.3 : 1.75} />
                  {to === '/trade' && openPositions > 0 && (
                    <span className="mnav-badge">{openPositions > 9 ? '9+' : openPositions}</span>
                  )}
                </div>
                <span className="mnav-label">{label}</span>
                {isActive && <span className="mnav-active-dot" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
