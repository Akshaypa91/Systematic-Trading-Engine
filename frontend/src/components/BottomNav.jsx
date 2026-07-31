// src/components/BottomNav.jsx
// Mobile-only (<1024px) bottom bar. Desktop uses StatusBar.jsx — see AppShell.
//
// Five slots, so they go to the five things a trader opens the app FOR, not to
// a sample of the sitemap. The previous set carried Journal and Screener: both
// are occasional tools — you journal after the fact and screen when hunting a
// new idea — while Portfolio, the single most-checked screen in any broker app,
// was missing entirely and Swing Setup (the strategy this project is built
// around, checked daily for fresh breakouts) needed the drawer.
//
// Order follows the session: see the market → read the signals → act → check
// what you hold → review the strategy. Trade sits in the middle because it is
// the primary action and the centre is the easiest thumb reach.
//
// Everything else stays one tap away in the drawer, which is where occasional
// destinations belong.
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Radio, Wallet, Rocket } from 'lucide-react';
import { useWS } from '../context/WSContext';

const NAV = [
  { to: '/',          icon: LayoutDashboard, label: 'Home',   end: true },
  { to: '/signals',   icon: Radio,           label: 'Signals' },
  { to: '/trade',     icon: ArrowLeftRight,  label: 'Trade' },
  { to: '/positions', icon: Wallet,          label: 'Portfolio' },
  { to: '/swing',     icon: Rocket,          label: 'Swing' },
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
                  {/* Open-position count belongs on Portfolio, not Trade: it
                      describes what you already hold, not an action waiting to
                      be taken. Real count from the WS portfolio feed. */}
                  {to === '/positions' && openPositions > 0 && (
                    <span className="mnav-badge" aria-label={`${openPositions} open positions`}>
                      {openPositions > 9 ? '9+' : openPositions}
                    </span>
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
