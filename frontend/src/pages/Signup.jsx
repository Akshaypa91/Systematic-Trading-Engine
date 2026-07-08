// src/pages/Signup.jsx — v2 split-screen signup.
// UI only: authAPI.signup / authAPI.googleAuth flows unchanged, including the
// success → redirect-to-login behavior. Adds a progress stepper, live
// password strength + match validation, and a stateful CTA.
import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { Mail, Lock, ShieldCheck, Check } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';
import {
  FloatingField, PasswordStrength, passwordStrength, AuthCta,
  AuthDivider, GoogleSlot, AuthError, AuthSuccess,
} from '../components/auth/AuthControls';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function Steps({ done }) {
  return (
    <div className="auth-steps" aria-label={done ? 'Step 2 of 2: done' : 'Step 1 of 2: create account'}>
      <div className="auth-step" data-state={done ? 'done' : 'active'}>
        <span className="auth-step-dot">{done ? <Check size={11} /> : '1'}</span>
        <span>Account</span>
      </div>
      <span className="auth-step-bar" />
      <div className="auth-step" data-state={done ? 'active' : undefined}>
        <span className="auth-step-dot">2</span>
        <span>Sign in &amp; trade</span>
      </div>
    </div>
  );
}

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState('idle');
  const [gLoading, setGLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const mismatch = confirm && confirm !== password;
  const tooShort = password && password.length < 8;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) { setError('All fields required'); setState('error'); return; }
    if (password !== confirm) { setError('Passwords do not match'); setState('error'); return; }
    if (password.length < 8) { setError('Password must be ≥ 8 characters'); setState('error'); return; }
    setState('loading'); setError('');
    try {
      await authAPI.signup(email, password);
      setState('success');
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Signup failed');
      setState('error');
    }
  }

  const handleGoogle = useCallback(async (credentialResponse) => {
    setGLoading(true); setError('');
    try {
      const res = await authAPI.googleAuth(credentialResponse.credential);
      const token = res.data.token;
      const user = res.data.user;
      if (!token) throw new Error('No token received');
      login(token, user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Google signup failed');
      setState('error');
    } finally { setGLoading(false); }
  }, [login, navigate]);

  const inner = (
    <AuthLayout>
      <div className="auth-card">
        {success ? (
          <>
            <Steps done />
            <AuthSuccess icon={ShieldCheck} title="Account created!">
              Welcome to SYSTRA, <strong style={{ color: 'var(--text-secondary)' }}>{email}</strong>.
              <br />Taking you to sign in…
            </AuthSuccess>
          </>
        ) : (
          <>
            <Steps />
            <h2>Create your account</h2>
            <p className="auth-card-sub">Free paper trading · no card required.</p>

            <AuthError>{error}</AuthError>

            {GOOGLE_CLIENT_ID && (
              <>
                <GoogleSlot busy={gLoading}>
                  <GoogleLogin
                    onSuccess={handleGoogle}
                    onError={() => { setError('Google sign-up failed'); setState('error'); }}
                    theme="filled_black" shape="rectangular" size="large" width="100%"
                    text="signup_with"
                  />
                </GoogleSlot>
                <AuthDivider>OR SIGN UP WITH EMAIL</AuthDivider>
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
                name="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (state === 'error') setState('idle'); }}
                error={tooShort ? 'At least 8 characters' : undefined}
                required
              >
                <PasswordStrength password={password} />
              </FloatingField>
              <FloatingField
                label="Confirm password"
                icon={ShieldCheck}
                revealable
                name="confirm-password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); if (state === 'error') setState('idle'); }}
                error={mismatch ? 'Passwords do not match' : undefined}
                hint={confirm && !mismatch ? 'Passwords match' : undefined}
                required
              />

              <AuthCta
                state={state === 'error' ? 'error' : state}
                loadingText="Creating account…"
                successText="Account created"
                disabled={!!mismatch || (password && passwordStrength(password) < 1)}
              >
                Create Account
              </AuthCta>
            </form>

            <p className="auth-fineprint" style={{ marginTop: 18 }}>
              Already have an account?{' '}
              <Link to="/login" className="auth-link">Sign in</Link>
            </p>
            <p className="auth-fineprint">
              By creating an account you agree to our{' '}
              <a href="#terms" className="auth-link muted">Terms</a> &amp;{' '}
              <a href="#privacy" className="auth-link muted">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );

  return GOOGLE_CLIENT_ID
    ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{inner}</GoogleOAuthProvider>
    : inner;
}
