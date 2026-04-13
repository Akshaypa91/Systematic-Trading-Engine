import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Zap, Search, TrendingUp, Activity, Radio, ArrowLeftRight } from 'lucide-react';

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard',    end: true },
  { to: '/live',     icon: Zap,             label: 'Live Trading' },
  { to: '/signals',  icon: Radio,           label: 'Signals' },
  { to: '/screener', icon: Search,          label: 'Screener' },
  { to: '/backtest', icon: TrendingUp,      label: 'Backtest' },
  { to: '/trade',    icon: ArrowLeftRight, label: 'Trade' },
];

function isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const ist = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  return ist >= 555 && ist <= 930;
}

export default function Sidebar() {
  const open = isMarketOpen();
  return (
    <aside className="fixed left-0 bottom-0 z-40 flex flex-col py-4 px-3"
      style={{ top:'var(--navbar-h)', width:'var(--sidebar-w)', background:'var(--bg-surface)', borderRight:'1px solid var(--border)' }}>

      {/* Section label */}
      <div className="section-label px-3 mb-3">Navigation</div>

      <nav className="flex flex-col gap-0.5 flex-1">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icon size={14} strokeWidth={1.8} />
            <span style={{ fontSize:13 }}>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Market status card */}
      <div style={{ margin:'0 4px 4px', padding:'12px 14px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10 }}>
        <div className="section-label mb-2">NSE Market</div>
        <div className="flex items-center gap-2">
          <span className={`live-dot ${open ? '' : 'stopped'}`} style={{ width:6, height:6 }} />
          <span className="font-mono" style={{ fontSize:11, fontWeight:600, color: open ? 'var(--green)' : 'var(--red)' }}>
            {open ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
        <div className="font-mono mt-1.5" style={{ fontSize:10, color:'var(--text-muted)' }}>9:15 – 15:30 IST</div>
      </div>
    </aside>
  );
}