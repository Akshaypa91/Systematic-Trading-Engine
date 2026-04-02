import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Search, TrendingUp, Activity } from 'lucide-react';

const NAV = [
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard',   end: true },
  { to: '/screener',  icon: Search,          label: 'Screener' },
  { to: '/backtest',  icon: TrendingUp,      label: 'Backtest' },
  { to: '/signals',   icon: Activity,        label: 'Signals' },
];

export default function Sidebar() {
  return (
    <aside
      className="fixed left-0 top-14 bottom-0 w-48 flex flex-col py-4 px-2 z-40"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all ${
                isActive ? 'active-nav' : ''
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? 'rgba(0,212,255,0.08)' : 'transparent',
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              border: isActive ? '1px solid rgba(0,212,255,0.15)' : '1px solid transparent',
              fontWeight: isActive ? 600 : 400,
            })}
            onMouseEnter={(e) => {
              if (!e.currentTarget.classList.contains('active-nav')) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.style.border.includes('var(--accent-cyan)')) {
                e.currentTarget.style.background = '';
                e.currentTarget.style.color = '';
              }
            }}
          >
            <Icon size={15} />
            <span className="tracking-wide">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Market status */}
      <div className="mt-auto mx-2 p-3 rounded-lg"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>NSE MARKET</div>
        <div className="flex items-center gap-1.5 mt-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-amber)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--accent-amber)' }}>
            {isMarketOpen() ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
        <div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
          9:15 – 15:30 IST
        </div>
      </div>
    </aside>
  );
}

function isMarketOpen() {
  const now = new Date();
  const hours = now.getUTCHours() + 5.5 / 1; // rough IST
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const ist = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  return ist >= 555 && ist <= 930; // 9:15 to 15:30
}
