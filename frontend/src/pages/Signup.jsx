import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { Eye, EyeOff, AlertCircle, CheckCircle, Sun, Moon } from 'lucide-react';

function SystraLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="11" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
      <polyline points="7,29 12,20 17,24 22,14 27,18 33,11" stroke="var(--cyan)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="27" cy="11" r="2.2" fill="var(--cyan)"/>
      <line x1="7" y1="32" x2="33" y2="32" stroke="rgba(59,130,246,0.25)" strokeWidth="1"/>
      <circle cx="12" cy="20" r="1.5" fill="rgba(59,130,246,0.5)"/>
      <circle cx="17" cy="24" r="1.5" fill="rgba(59,130,246,0.5)"/>
      <circle cx="22" cy="14" r="1.5" fill="rgba(59,130,246,0.5)"/>
    </svg>
  );
}
import { useThemeContext } from '../context/ThemeContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function Divider() {
  return (
    <div className="flex items-center gap-3 my-5">
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>or</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

export default function Signup() {
  const { isDark, toggleTheme } = useThemeContext();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password)   { setError('All fields required'); return; }
    if (password !== confirm)  { setError('Passwords do not match'); return; }
    if (password.length < 8)   { setError('Password must be ≥ 8 characters'); return; }
    setLoading(true); setError('');
    try {
      await authAPI.signup(email, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Signup failed');
    } finally { setLoading(false); }
  }

  const handleGoogle = useCallback(async (credentialResponse) => {
    setGLoading(true); setError('');
    try {
      const res   = await authAPI.googleAuth(credentialResponse.credential);
      const token = res.data.token;
      const user  = res.data.user;
      if (!token) throw new Error('No token received');
      login(token, user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Google signup failed');
    } finally { setGLoading(false); }
  }, [login, navigate]);

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center grid-bg">
        <div className="text-center fade-in">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)' }}>
            <CheckCircle size={32} style={{ color: 'var(--green)' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Account Created!</h2>
          <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>Redirecting to login...</p>
        </div>
      </div>
    );
  }

  const inner = (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden grid-bg">
      <button onClick={toggleTheme}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 999,
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          cursor: 'pointer', color: 'var(--text-muted)',
        }}
        title={isDark ? 'Switch to Light' : 'Switch to Dark'}
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in srgb, var(--cyan) 6%, transparent), transparent)' }} />

      <div className="w-full max-w-sm mx-4 fade-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <SystraLogo />
          <div>
            <div className="text-lg font-bold tracking-widest uppercase" style={{ color: 'var(--cyan)' }}>SYSTRA</div>
            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Systematic Trading Engine</div>
          </div>
        </div>

        <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Create Account</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Join the trading engine</p>

          {error && (
            <div className="flex items-start gap-2 text-xs font-mono px-3 py-2.5 rounded-lg mb-4"
              style={{ background: 'color-mix(in srgb, var(--red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)', color: 'var(--red)' }}>
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}

          {/* Google button */}
          {GOOGLE_CLIENT_ID && (
            <div style={{ opacity: gLoading ? 0.6 : 1, pointerEvents: gLoading ? 'none' : 'auto' }}>
              <GoogleLogin
                onSuccess={handleGoogle}
                onError={() => setError('Google sign-up failed')}
                theme="filled_black" shape="rectangular" size="large" width="100%"
                text="signup_with"
              />
            </div>
          )}

          <Divider />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-mono uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="trader@example.com" autoComplete="email"
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono), monospace' }}
                onFocus={e => e.target.style.borderColor = 'color-mix(in srgb, var(--cyan) 50%, transparent)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters" autoComplete="new-password"
                  className="w-full px-4 py-2.5 pr-10 rounded-lg text-sm outline-none transition-all"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono), monospace' }}
                  onFocus={e => e.target.style.borderColor = 'color-mix(in srgb, var(--cyan) 50%, transparent)'}
                  onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter password" autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: 'var(--bg-elevated)',
                  border: `1px solid ${confirm && confirm !== password ? 'color-mix(in srgb, var(--red) 50%, transparent)' : 'var(--border)'}`,
                  color: 'var(--text-primary)', fontFamily: 'var(--font-mono), monospace'
                }}
                onFocus={e => { if (!confirm || confirm === password) e.target.style.borderColor = 'color-mix(in srgb, var(--cyan) 50%, transparent)'; }}
                onBlur={e  => { e.target.style.borderColor = confirm && confirm !== password ? 'color-mix(in srgb, var(--red) 50%, transparent)' : 'var(--border)'; }} />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-lg text-sm font-semibold tracking-wide transition-all disabled:opacity-60"
              style={{ background: 'color-mix(in srgb, var(--cyan) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--cyan) 40%, transparent)', color: 'var(--cyan)' }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'color-mix(in srgb, var(--cyan) 20%, transparent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--cyan) 12%, transparent)'; }}>
              {loading ? 'Creating Account...' : 'Create Account →'}
            </button>
          </form>

          <p className="text-center text-xs mt-5" style={{ color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--cyan)' }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );

  return GOOGLE_CLIENT_ID
    ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{inner}</GoogleOAuthProvider>
    : inner;
}
