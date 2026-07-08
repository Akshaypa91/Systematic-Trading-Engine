// src/pages/Login.jsx — v2 split-screen auth experience.
// UI only: authAPI.login / authAPI.googleAuth / JWT handling via useAuth()
// are byte-for-byte the same flow as v1. Adds remember-me (email prefill,
// stored locally), floating-label inputs, stateful CTA and success animation.
import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { Mail, Lock } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';
import {
  FloatingField, AuthCta, AuthDivider, GoogleSlot, AuthError,
} from '../components/auth/AuthControls';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const REMEMBER_KEY = 'systra.auth.rememberedEmail';

export default function Login() {
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => !!localStorage.getItem(REMEMBER_KEY));
  const [state, setState] = useState('idle'); // idle | loading | success | error
  const [gLoading, setGLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  function persistRemember() {
    try {
      if (remember && email) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch { /* ignore */ }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) { setError('Email and password required'); setState('error'); return; }
    setState('loading'); setError('');
    try {
      const res = await authAPI.login(email, password);
      const data = res.data;
      const token = data.token || data.accessToken || data.jwt;
      const user = data.user || { email };
      if (!token) throw new Error('No token received');
      persistRemember();
      login(token, user);
      setState('success');
      setTimeout(() => navigate('/'), 450);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Login failed');
      setState('error');
    }
  }

  const handleGoogle = useCallback(async (credentialResponse) => {
    setGLoading(true); setError('');
    try {
      const res = await authAPI.googleAuth(credentialResponse.credential);
      const data = res.data;
      const token = data.token;
      const user = data.user;
      if (!token) throw new Error('No token received');
      login(token, user);
      setState('success');
      setTimeout(() => navigate('/'), 350);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Google login failed');
      setState('error');
    } finally {
      setGLoading(false);
    }
  }, [login, navigate]);

  const inner = (
    <AuthLayout>
      <div className="auth-card">
        <h2>Welcome back</h2>
        <p className="auth-card-sub">Sign in to your trading workspace.</p>

        <AuthError>{error}</AuthError>

        {GOOGLE_CLIENT_ID && (
          <>
            <GoogleSlot busy={gLoading}>
              <GoogleLogin
                onSuccess={handleGoogle}
                onError={() => { setError('Google sign-in failed'); setState('error'); }}
                theme="filled_black"
                shape="rectangular"
                size="large"
                width="100%"
                text="continue_with"
              />
            </GoogleSlot>
            <AuthDivider />
          </>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <FloatingField
            label="Email address"
            icon={Mail}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
            required
          />
          <FloatingField
            label="Password"
            icon={Lock}
            revealable
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (state === 'error') setState('idle'); }}
            required
          />

          <div className="auth-row">
            <label className="auth-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember me
            </label>
            <Link to="/forgot-password" className="auth-link">Forgot password?</Link>
          </div>

          <AuthCta
            state={state === 'error' ? 'error' : state}
            loadingText="Authenticating…"
            successText="Signed in"
          >
            Sign In
          </AuthCta>
        </form>

        <p className="auth-fineprint" style={{ marginTop: 18 }}>
          No account?{' '}
          <Link to="/signup" className="auth-link">Create one free</Link>
        </p>

        <p className="auth-fineprint">
          By signing in you agree to our{' '}
          <a href="#terms" className="auth-link muted">Terms</a> &amp;{' '}
          <a href="#privacy" className="auth-link muted">Privacy Policy</a>.
        </p>
      </div>
    </AuthLayout>
  );

  return GOOGLE_CLIENT_ID
    ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{inner}</GoogleOAuthProvider>
    : inner;
}
