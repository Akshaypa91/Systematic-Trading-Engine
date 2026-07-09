// src/components/Navbar.jsx — v4 trading-terminal top bar
// Brand · ⌘K search · live feed status · IST clock · quick order ·
// notifications (real WS trade events) · theme · user menu.
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WSContext';
import {
  LogOut, Zap, WifiOff, RefreshCw, Menu, X, Search, Bell,
  BookOpen, MessageSquare, ChevronDown, ArrowLeftRight,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import CommandPalette from './CommandPalette';

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <>{time}</>;
}

function WSPill({ status, onReconnect }) {
  if (status === 'connected')
    return (
      <div className="ws-pill connected" title="Live WebSocket feed">
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
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

function useClickOutside(ref, onOutside, enabled) {
  useEffect(() => {
    if (!enabled) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onOutside(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside, enabled]);
}

export default function Navbar({ onMenuToggle, menuOpen }) {
  const { user, logout } = useAuth();
  const { status, reconnect, trades } = useWS();
  const navigate = useNavigate();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const userRef = useRef(null);
  const notifRef = useRef(null);

  useClickOutside(userRef, () => setUserOpen(false), userOpen);
  useClickOutside(notifRef, () => setNotifOpen(false), notifOpen);

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unseen = Math.max(0, trades.length - seenCount);

  function handleLogout() { logout(); navigate('/login'); }
  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email || 'U')[0].toUpperCase();

  return (
    <header
      className="nb-root fixed top-0 left-0 right-0 z-50 flex items-center px-3 gap-2"
      style={{
        height: 'var(--navbar-h)',
        background: 'var(--navbar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--navbar-border)',
      }}
    >
      {/* Hamburger (mobile) */}
      <button
        onClick={onMenuToggle}
        className="nb-lg-down nb-icon-btn"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        style={menuOpen ? { color: 'var(--cyan)', borderColor: 'color-mix(in srgb, var(--cyan) 30%, transparent)' } : undefined}
      >
        {menuOpen ? <X size={14} /> : <Menu size={14} />}
      </button>

      {/* Brand */}
      <Link to="/" className="flex items-center gap-2" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: 'color-mix(in srgb, var(--cyan) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--cyan) 22%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Zap size={12} style={{ color: 'var(--cyan)' }} />
        </div>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.07em' }}>
          SYSTRA
        </span>
      </Link>

      {/* Search / command palette trigger */}
      <button
        className="nb-search nb-sm-up"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search symbols and pages (Ctrl+K)"
        style={{ marginLeft: 10 }}
      >
        <Search size={13} />
        <span className="nb-search-text">Search symbols, pages…</span>
        <span className="kbd">⌘K</span>
      </button>
      {/* Mobile search icon */}
      <button className="nb-sm-down nb-icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Search">
        <Search size={14} />
      </button>

      <div style={{ flex: 1 }} />

      {/* Right controls */}
      <div className="flex items-center gap-2">
        <WSPill status={status} onReconnect={reconnect} />

        {/* Clock */}
        <div className="nb-md-up nb-chip" title="IST — Indian Standard Time">
          <LiveClock />
          <span style={{ color: 'var(--text-dim)' }}>IST</span>
        </div>

        {/* Quick order */}
        <button
          className="nb-md-up nb-chip clickable"
          onClick={() => navigate('/trade')}
          style={{ color: 'var(--cyan)', borderColor: 'color-mix(in srgb, var(--cyan) 26%, transparent)' }}
          title="Open the order terminal (g t)"
        >
          <ArrowLeftRight size={12} />
          Quick Order
        </button>

        {/* Notifications — real WS trade events */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <button
            className="nb-icon-btn"
            aria-label={`Notifications${unseen ? ` (${unseen} new)` : ''}`}
            aria-expanded={notifOpen}
            onClick={() => setNotifOpen((o) => { if (!o) setSeenCount(trades.length); return !o; })}
          >
            <Bell size={13} />
            {unseen > 0 && (
              <span className="status-badge-count" aria-hidden="true">{unseen > 9 ? '9+' : unseen}</span>
            )}
          </button>
          {notifOpen && (
            <div className="nb-menu" style={{ width: 290, maxHeight: 340, overflowY: 'auto' }} role="menu">
              <div className="nb-menu-head ui-between">
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Trade alerts</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>this session</span>
              </div>
              <div className="nb-menu-sep" />
              {trades.length === 0 ? (
                <div className="notif-empty">No trades yet this session</div>
              ) : (
                trades.slice(0, 8).map((t, i) => (
                  <div key={i} className="notif-row">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {t.symbol || t.action}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {t.action} · qty {t.qty ?? t.quantity ?? '—'}
                      </span>
                    </div>
                    <span className={`badge ${t.action === 'BUY' ? 'badge-buy' : 'badge-sell'}`}>{t.action}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <ThemeToggle compact />

        {/* User menu */}
        {user && (
          <div style={{ position: 'relative' }} ref={userRef}>
            <button
              onClick={() => setUserOpen((o) => !o)}
              aria-label="Account menu"
              aria-expanded={userOpen}
              className="flex items-center gap-1.5"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 8 }}
            >
              {user.picture ? (
                <img
                  src={user.picture} alt=""
                  referrerPolicy="no-referrer"
                  style={{ width: 27, height: 27, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }}
                />
              ) : (
                <div style={{
                  width: 27, height: 27, borderRadius: '50%', flexShrink: 0,
                  background: 'color-mix(in srgb, var(--cyan) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--cyan) 22%, transparent)',
                  color: 'var(--cyan)', fontSize: 10.5, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {initials}
                </div>
              )}
              <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
            </button>

            {userOpen && (
              <div className="nb-menu" role="menu">
                <div className="nb-menu-head">
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.name || 'Trader'}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.email}
                  </div>
                </div>
                <div className="nb-menu-sep" />
                <Link to="/journal" className="nb-menu-item" role="menuitem">
                  <BookOpen size={13} /> Trade journal
                </Link>
                <Link to="/feedback" className="nb-menu-item" role="menuitem">
                  <MessageSquare size={13} /> Send feedback
                </Link>
                <div className="nb-menu-sep" />
                <button onClick={handleLogout} className="nb-menu-item danger" role="menuitem">
                  <LogOut size={13} /> Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
