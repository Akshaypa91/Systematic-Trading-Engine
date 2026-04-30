// src/components/Sidebar.jsx — Premium redesign v3
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Zap, Search, TrendingUp,
  Activity, Radio, ArrowLeftRight, X
} from 'lucide-react';

const NAV = [
  { to:'/',         icon:LayoutDashboard, label:'Dashboard',    end:true },
  { to:'/live',     icon:Zap,             label:'Live Trading' },
  { to:'/signals',  icon:Radio,           label:'Signals' },
  { to:'/screener', icon:Search,          label:'Screener' },
  { to:'/backtest', icon:TrendingUp,      label:'Backtest' },
  { to:'/trade',    icon:ArrowLeftRight,  label:'Trade' },
];

function isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const ist = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  return ist >= 555 && ist <= 930;
}

export default function Sidebar({ open, onClose }) {
  const location    = useLocation();
  const marketOpen  = isMarketOpen();

  useEffect(() => { if (onClose) onClose(); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          className="lg:hidden fixed inset-0 z-40"
          style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)', animation:'fadeIn 0.2s ease-out' }}
        />
      )}

      <aside
        className="fixed left-0 bottom-0 z-40 flex flex-col"
        style={{
          top: 'var(--navbar-h)',
          width: 'var(--sidebar-w)',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          padding: '12px 10px',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.16,1,0.3,1)',
        }}
        data-open={open}
      >
        {/* Mobile close */}
        <button
          onClick={onClose}
          className="lg:hidden absolute top-3 right-3"
          style={{
            width:28, height:28, borderRadius:7, display:'flex',
            alignItems:'center', justifyContent:'center',
            background:'var(--bg-elevated)', border:'1px solid var(--border)',
            color:'var(--text-muted)', cursor:'pointer',
          }}
        >
          <X size={13} />
        </button>

        {/* Nav label */}
        <div style={{ padding:'4px 10px 10px', fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)' }}>
          Menu
        </div>

        {/* Nav items */}
        <nav style={{ display:'flex', flexDirection:'column', gap:2, flex:1 }}>
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={15} strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Market status */}
        <div style={{
          margin:'8px 2px 0', padding:'12px 12px',
          background:'var(--bg-elevated)', border:'1px solid var(--border)',
          borderRadius:10,
        }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:8 }}>
            NSE Market
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span
              style={{
                width:7, height:7, borderRadius:'50%', flexShrink:0,
                background: marketOpen ? 'var(--green)' : 'var(--red)',
                boxShadow: marketOpen ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
              }}
            />
            <span style={{
              fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600,
              color: marketOpen ? 'var(--green)' : 'var(--red)',
            }}>
              {marketOpen ? 'OPEN' : 'CLOSED'}
            </span>
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
            9:15 – 15:30 IST
          </div>
        </div>
      </aside>
    </>
  );
}
