// src/components/Sidebar.jsx — v4
// Grouped navigation with active-edge indicator, desktop collapse-to-rail
// (persisted, icon tooltips) and a live NSE market chip in the footer.
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Zap, Search, TrendingUp, Radio, ArrowLeftRight,
  X, MessageSquare, BarChart2, BookOpen, PanelLeftClose, PanelLeftOpen, Play, Rocket, ScrollText, Wallet, Activity, Gauge,
} from 'lucide-react';

const GROUPS = [
  {
    label: 'Trading',
    items: [
      { to: '/',       icon: LayoutDashboard, label: 'Dashboard',    kbd: 'G D', end: true },
      { to: '/trade',  icon: ArrowLeftRight,  label: 'Trade',        kbd: 'G T' },
      // NOT real money — this is the simulated auto-trading engine. Calling it
      // "Live Trading" next to a real-money LIVE mode was genuinely dangerous.
      { to: '/live',   icon: Zap,             label: 'Paper Engine', kbd: 'G L' },
      { to: '/orders', icon: ScrollText,      label: 'Live Orders',  kbd: 'G O' },
      { to: '/positions', icon: Wallet,       label: 'Portfolio',    kbd: 'G P' },
      { to: '/signals', icon: Radio,          label: 'Signals',      kbd: 'G S' },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/screener',  icon: Search,     label: 'Screener',  kbd: 'G C' },
      { to: '/backtest',  icon: TrendingUp, label: 'Backtest',  kbd: 'G B' },
      { to: '/analytics', icon: BarChart2,  label: 'Analytics', kbd: 'G A' },
      { to: '/swing',     icon: Rocket,     label: 'Swing Setup', kbd: 'G W' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { to: '/journal',  icon: BookOpen,      label: 'Journal',  kbd: 'G J' },
      { to: '/execution', icon: Gauge,        label: 'Execution', kbd: 'G E' },
      { to: '/diagnostics', icon: Activity,   label: 'Diagnostics', kbd: 'G X' },
      { to: '/feedback', icon: MessageSquare, label: 'Feedback' },
    ],
  },
];

function isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const ist = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  return ist >= 555 && ist <= 930;
}

const COLLAPSE_KEY = 'systra.sidebar.collapsed';

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const marketOpen = isMarketOpen();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1'
  );

  // Reflect collapse state as a root attribute so --sidebar-w (and every
  // layout offset derived from it) updates in one place.
  useEffect(() => {
    document.documentElement.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => { if (onClose) onClose(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Backdrop (mobile drawer) */}
      {open && (
        <div
          onClick={onClose}
          className="lg:hidden fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease-out' }}
        />
      )}

      <aside className="sidebar" data-open={open} aria-label="Primary navigation">
        {/* Mobile close */}
        <button
          onClick={onClose}
          className="nb-lg-down nb-icon-btn"
          aria-label="Close menu"
          style={{ position: 'absolute', top: 10, right: 10 }}
        >
          <X size={13} />
        </button>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {GROUPS.map(({ label, items }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="sb-group-label">{label}</div>
              {items.map(({ to, icon: Icon, label: name, kbd, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span className="sb-label">{name}</span>
                  {kbd && <span className="sb-kbd">{kbd}</span>}
                  <span className="sb-tip" role="tooltip">{name}</span>
                </NavLink>
              ))}
            </div>
          ))}

          {/* Quick actions */}
          <div className="sb-group-label" style={{ marginTop: 6 }}>Quick actions</div>
          <button className="sb-item" onClick={() => navigate('/backtest')}>
            <Play size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="sb-label">New backtest</span>
            <span className="sb-tip" role="tooltip">New backtest</span>
          </button>
          <button className="sb-item" onClick={() => navigate('/trade')}>
            <Zap size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="sb-label">Quick order</span>
            <span className="sb-tip" role="tooltip">Quick order</span>
          </button>
        </nav>

        <div className="sb-footer">
          {/* Market status */}
          <div className="sb-market">
            <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 7 }}>
              NSE Market
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`live-dot${marketOpen ? '' : ' stopped'}`} style={{ width: 7, height: 7 }} />
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: marketOpen ? 'var(--green)' : 'var(--red)' }}>
                {marketOpen ? 'OPEN' : 'CLOSED'}
              </span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                9:15–15:30
              </span>
            </div>
          </div>

          {/* Collapse toggle (desktop only via CSS) */}
          <button
            className="sb-collapse"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
