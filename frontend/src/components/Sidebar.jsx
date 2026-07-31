// src/components/Sidebar.jsx — v4
// Grouped navigation with active-edge indicator, desktop collapse-to-rail
// (persisted, icon tooltips) and a live NSE market chip in the footer.
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Briefcase, Receipt, Bot, Radio,
  Filter, History, BarChart2, CandlestickChart, Zap, GitCompareArrows,
  BookOpen, Gauge, Activity, MessageSquare,
  X, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

// Grouped by the loop a systematic trader actually runs:
//   research an idea → pick the strategy → execute it → review what happened.
//
// The previous grouping mixed those stages. "Signals" sat under Trading though
// it produces ideas, not orders. The three actual strategies (Swing, Scalper,
// Spread) were buried among the generic research tools. "Execution" sat in
// Workspace two groups away from "Live Orders" despite being the report card
// for those same fills — and its bare label read as a place to send orders.
//
// Quick Actions ("New backtest", "Quick order") was also removed: both entries
// navigated to routes already listed a few rows above, so it cost two rows of a
// scrolling sidebar to duplicate links the user could already see.
// Icons carry real weight here: in collapsed rail mode they are the ONLY label,
// so every one must be unique and mean something. Two were previously reused —
// Zap for both Paper Engine and Intraday Scalper, ArrowLeftRight for both Trade
// and NSE-BSE Spread — which made those pairs indistinguishable on the rail.
// check-nav.mjs now fails the build if any icon is used twice.
const GROUPS = [
  {
    label: 'Trading',
    items: [
      { to: '/',          icon: LayoutDashboard, label: 'Dashboard',   kbd: 'G D', end: true },
      // The canonical buy/sell exchange glyph.
      { to: '/trade',     icon: ArrowLeftRight,  label: 'Trade',       kbd: 'G T' },
      // Briefcase, not Wallet: this is holdings, not cash. Funds live elsewhere.
      { to: '/positions', icon: Briefcase,       label: 'Portfolio',   kbd: 'G P' },
      // Receipt reads as contract notes / order book.
      { to: '/orders',    icon: Receipt,         label: 'Live Orders', kbd: 'G O' },
      // NOT real money — this is the simulated auto-trading engine. Calling it
      // "Live Trading" next to a real-money LIVE mode was genuinely dangerous.
      // Bot says "runs itself" and frees Zap for the scalper.
      { to: '/live',      icon: Bot,             label: 'Paper Engine', kbd: 'G L' },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/signals',   icon: Radio,     label: 'Signals',   kbd: 'G S' },
      // Filter, not Search: a screener narrows a universe. Search is already
      // the navbar's symbol lookup, so reusing it blurred two different jobs.
      { to: '/screener',  icon: Filter,    label: 'Screener',  kbd: 'G C' },
      // History: a backtest replays the past. TrendingUp implied a result.
      { to: '/backtest',  icon: History,   label: 'Backtest',  kbd: 'G B' },
      { to: '/analytics', icon: BarChart2, label: 'Analytics', kbd: 'G A' },
    ],
  },
  {
    label: 'Strategies',
    items: [
      // A rocket is startup iconography, not finance. Candlesticks are the
      // universal language of a swing setup.
      { to: '/swing',    icon: CandlestickChart, label: 'Swing Setup',      kbd: 'G W' },
      { to: '/intraday', icon: Zap,              label: 'Intraday Scalper', kbd: 'G I' },
      // Two venues being compared — the whole point of the page.
      { to: '/spread',   icon: GitCompareArrows, label: 'NSE-BSE Spread',   kbd: 'G R' },
    ],
  },
  {
    label: 'Review',
    items: [
      { to: '/journal',     icon: BookOpen, label: 'Journal',       kbd: 'G J' },
      // "Execution" alone read like an action. This page scores fills.
      { to: '/execution',   icon: Gauge,    label: 'Fill Quality',  kbd: 'G E' },
      { to: '/diagnostics', icon: Activity, label: 'Diagnostics',   kbd: 'G X' },
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
  // While the drawer is open it IS the navigation, so the fixed bottom bar is
  // both redundant and harmful: it renders above the drawer and covered its
  // footer (market status and the Feedback link were unreachable). A body class
  // lets CSS hide it — the bar lives in a different subtree, so it can't be
  // toggled by passing props down.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    document.body.classList.toggle('nav-drawer-open', !!open);
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('nav-drawer-open');
    };
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

        </nav>

        <div className="sb-footer">
          {/* Feedback is app meta, not a workspace tool — it belongs with the
              other chrome at the bottom rather than taking a slot in a
              navigation group. */}
          <NavLink to="/feedback" className={({ isActive }) => `sb-item${isActive ? ' active' : ''}`}>
            <MessageSquare size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="sb-label">Feedback</span>
            <span className="sb-tip" role="tooltip">Feedback</span>
          </NavLink>

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
