// src/components/Navbar.jsx — Premium redesign v3
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS }   from '../context/WSContext';
import { LogOut, Zap, WifiOff, RefreshCw, Menu, X } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour12:false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono" style={{ fontSize:12, color:'var(--text-muted)', letterSpacing:'0.04em' }}>
      {time}
    </span>
  );
}

function WSPill({ status, onReconnect }) {
  if (status === 'connected')
    return (
      <div className="ws-pill connected">
        <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--green)', display:'inline-block' }} />
        LIVE
      </div>
    );
  if (status === 'connecting')
    return <div className="ws-pill connecting"><RefreshCw size={8} className="animate-spin" />Connecting</div>;
  return (
    <button className="ws-pill disconnected" onClick={onReconnect} title="Reconnect">
      <WifiOff size={8} />Offline
    </button>
  );
}

export default function Navbar({ onMenuToggle, menuOpen }) {
  const { user, logout }    = useAuth();
  const { status, reconnect } = useWS();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }
  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
    : (user?.email || 'U')[0].toUpperCase();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 gap-3"
      style={{
        height: 'var(--navbar-h)',
        background: 'var(--navbar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--navbar-border)',
      }}
    >
      {/* Hamburger */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden flex items-center justify-center"
        style={{
          width:32, height:32, borderRadius:8, flexShrink:0, cursor:'pointer',
          background: menuOpen ? 'rgba(59,130,246,0.08)' : 'transparent',
          border: `1px solid ${menuOpen ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`,
          color: menuOpen ? 'var(--cyan)' : 'var(--text-muted)',
          transition: 'all 0.12s',
        }}
      >
        {menuOpen ? <X size={14} /> : <Menu size={14} />}
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2">
        <div style={{
          width:28, height:28, borderRadius:8, flexShrink:0,
          background:'rgba(59,130,246,0.12)', border:'1px solid rgba(59,130,246,0.2)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <Zap size={13} style={{ color:'var(--cyan)' }} />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span style={{ fontFamily:'var(--font-ui)', fontSize:14, fontWeight:700, color:'var(--text-primary)', letterSpacing:'0.08em' }}>
            SYSTRA
          </span>
          <span style={{
            fontSize:9, padding:'1px 5px', borderRadius:4,
            background:'var(--bg-elevated)', color:'var(--text-muted)',
            border:'1px solid var(--border)', fontFamily:'var(--font-mono)',
          }}>v2</span>
        </div>
      </div>

      <div style={{ flex:1 }} />

      {/* Right controls */}
      <div className="flex items-center gap-2">
        <WSPill status={status} onReconnect={reconnect} />

        {/* Clock */}
        <div className="hidden md:flex items-center gap-2"
          style={{ padding:'4px 10px', borderRadius:6, background:'var(--bg-elevated)', border:'1px solid var(--border)' }}>
          <LiveClock />
          <span style={{ color:'var(--border-bright)', fontSize:10 }}>·</span>
          <span className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>
            {new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}
          </span>
        </div>

        <ThemeToggle />

        {/* User */}
        {user && (
          <div className="flex items-center gap-2">
            {user.picture ? (
              <img
                src={user.picture} alt={user.name || user.email}
                referrerPolicy="no-referrer"
                style={{ width:28, height:28, borderRadius:'50%', objectFit:'cover', flexShrink:0, border:'1px solid var(--border)' }}
              />
            ) : (
              <div style={{
                width:28, height:28, borderRadius:'50%', flexShrink:0,
                background:'rgba(59,130,246,0.12)', border:'1px solid rgba(59,130,246,0.2)',
                color:'var(--cyan)', fontSize:11, fontWeight:600,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                {initials}
              </div>
            )}
            <span className="hidden xl:block" style={{ fontSize:13, color:'var(--text-secondary)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {user.name || user.email}
            </span>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="btn btn-ghost"
          style={{ padding:'5px 10px', fontSize:12 }}
        >
          <LogOut size={13} />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
