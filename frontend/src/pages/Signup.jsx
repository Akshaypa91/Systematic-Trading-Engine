import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { Zap, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';

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
            style={{ background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)' }}>
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

        <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Create Account</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Join the trading engine</p>

          {error && (
            <div className="flex items-start gap-2 text-xs font-mono px-3 py-2.5 rounded-lg mb-4"
              style={{ background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', color: 'var(--red)' }}>
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
                onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.5)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters" autoComplete="new-password"
                  className="w-full px-4 py-2.5 pr-10 rounded-lg text-sm outline-none transition-all"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono), monospace' }}
                  onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.5)'}
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
                  border: `1px solid ${confirm && confirm !== password ? 'rgba(255,71,87,0.5)' : 'var(--border)'}`,
                  color: 'var(--text-primary)', fontFamily: 'var(--font-mono), monospace'
                }}
                onFocus={e => { if (!confirm || confirm === password) e.target.style.borderColor = 'rgba(0,212,255,0.5)'; }}
                onBlur={e  => { e.target.style.borderColor = confirm && confirm !== password ? 'rgba(255,71,87,0.5)' : 'var(--border)'; }} />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-lg text-sm font-semibold tracking-wide transition-all disabled:opacity-60"
              style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)', color: 'var(--cyan)' }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'rgba(0,212,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.12)'; }}>
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
