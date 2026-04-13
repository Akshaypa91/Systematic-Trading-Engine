import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { Zap, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const { login } = useAuth();
  const navigate  = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required'); return; }
    setLoading(true); setError('');
    try {
      const res  = await authAPI.login(email, password);
      const data = res.data;
      const token = data.token || data.accessToken || data.jwt;
      const user  = data.user || { email };
      if (!token) throw new Error('No token received from server');
      login(token, user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden grid-bg">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(0,212,255,0.06), transparent)' }} />

      <div className="w-full max-w-sm mx-4 fade-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)' }}>
            <Zap size={20} style={{ color: 'var(--cyan)' }} />
          </div>
          <div>
            <div className="text-lg font-bold tracking-widest uppercase" style={{ color: 'var(--cyan)' }}>SYSTRA</div>
            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Systematic Trading Engine</div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sign In</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Access your trading dashboard</p>

          {error && (
            <div className="flex items-start gap-2 text-xs font-mono px-3 py-2.5 rounded-lg mb-4"
              style={{ background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', color: 'var(--red)' }}>
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-mono uppercase tracking-wider block mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="trader@example.com"
                autoComplete="email"
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono), monospace',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.5)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider block mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full px-4 py-2.5 pr-10 rounded-lg text-sm outline-none transition-all"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono), monospace',
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.5)'}
                  onBlur={e  => e.target.style.borderColor = 'var(--border)'}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-lg text-sm font-semibold tracking-wide transition-all disabled:opacity-60"
              style={{
                background: loading ? 'var(--bg-elevated)' : 'rgba(0,212,255,0.12)',
                border: '1px solid rgba(0,212,255,0.4)',
                color: 'var(--cyan)',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'rgba(0,212,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = loading ? 'var(--bg-elevated)' : 'rgba(0,212,255,0.12)'; }}>
              {loading ? 'Authenticating...' : 'Sign In →'}
            </button>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: 'var(--text-muted)' }}>
            No account?{' '}
            <Link to="/signup" className="transition-colors"
              style={{ color: 'var(--cyan)' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
              Create one
            </Link>
          </p>
        </div>

        <p className="text-center text-xs mt-6 font-mono" style={{ color: 'var(--text-muted)' }}>
          SYSTRA v2 · NSE India · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}