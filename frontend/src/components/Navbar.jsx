import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WSContext';
import { LogOut, Zap, RefreshCw, WifiOff } from 'lucide-react';

function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono" style={{ fontSize:11, color:'var(--text-muted)', letterSpacing:'0.05em' }}>{time}</span>;
}

function WSPill({ status, onReconnect }) {
  if (status === 'connected')
    return <div className="ws-pill connected"><span style={{width:5,height:5,borderRadius:'50%',background:'var(--green)',display:'inline-block'}} />WS LIVE</div>;
  if (status === 'connecting')
    return <div className="ws-pill connecting"><RefreshCw size={8} className="animate-spin" />CONNECTING</div>;
  return (
    <button className="ws-pill disconnected" onClick={onReconnect} title="Reconnect">
      <WifiOff size={8} />OFFLINE
    </button>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { status, reconnect } = useWS();
  const navigate = useNavigate();
  function handleLogout() { logout(); navigate('/login'); }
  const initials = (user?.email || 'U')[0].toUpperCase();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center px-5 gap-4"
      style={{ height:'var(--navbar-h)', background:'rgba(9,14,26,0.94)', backdropFilter:'blur(14px)', borderBottom:'1px solid var(--border)' }}>

      {/* Logo area */}
      <div className="flex items-center gap-2.5" style={{ minWidth:'var(--sidebar-w)' }}>
        <div className="flex items-center justify-center w-7 h-7 rounded-lg"
          style={{ background:'rgba(0,212,255,0.12)', border:'1px solid rgba(0,212,255,0.25)' }}>
          <Zap size={13} style={{ color:'var(--cyan)' }} />
        </div>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:700, color:'var(--cyan)', letterSpacing:'0.18em' }}>SYSTRA</span>
        <span className="font-mono" style={{ fontSize:9, padding:'2px 5px', borderRadius:4, background:'rgba(255,255,255,0.05)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>v2</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <WSPill status={status} onReconnect={reconnect} />

        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)' }}>
          <LiveClock />
          <span style={{ color:'var(--border-bright)', fontSize:10 }}>·</span>
          <span className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>
            {new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}
          </span>
        </div>

        {user && (
          <div className="flex items-center gap-2">
            <div style={{ width:26, height:26, borderRadius:'50%', background:'rgba(0,212,255,0.15)', color:'var(--cyan)', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {initials}
            </div>
            <span className="hidden lg:block" style={{ fontSize:12, color:'var(--text-secondary)' }}>{user.email}</span>
          </div>
        )}

        <button onClick={handleLogout} className="btn btn-ghost" style={{ padding:'6px 10px' }}>
          <LogOut size={12} /><span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
