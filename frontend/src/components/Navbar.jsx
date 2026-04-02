import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Activity, LogOut, Zap } from 'lucide-react';

export default function Navbar({ onMenuToggle }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: false });
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header
      style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
      className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 gap-4"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 min-w-[180px]">
        <div className="relative flex items-center justify-center w-7 h-7 rounded-md"
          style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)' }}>
          <Zap size={14} style={{ color: 'var(--accent-cyan)' }} />
        </div>
        <span className="text-sm font-bold tracking-widest uppercase"
          style={{ color: 'var(--accent-cyan)', letterSpacing: '0.15em' }}>
          SYSTRA
        </span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(0,212,255,0.08)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
          v2
        </span>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 ml-auto">
        <div className="relative flex items-center gap-1.5">
          <div className="relative w-2 h-2">
            <div className="absolute inset-0 rounded-full" style={{ background: 'var(--accent-green)' }} />
            <div className="pulse-ring" style={{ background: 'var(--accent-green)', opacity: 0.4 }} />
          </div>
          <span className="text-xs font-mono" style={{ color: 'var(--accent-green)' }}>LIVE</span>
        </div>

        <div className="hidden md:flex items-center gap-1 font-mono text-xs px-3 py-1 rounded"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <Activity size={10} />
          <span>{timeStr}</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span>{dateStr}</span>
        </div>

        {user && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)' }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'rgba(0,212,255,0.15)', color: 'var(--accent-cyan)' }}>
              {(user.email || 'U')[0].toUpperCase()}
            </div>
            <span className="hidden md:block">{user.email}</span>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-red)'; e.currentTarget.style.color = 'var(--accent-red)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <LogOut size={12} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
