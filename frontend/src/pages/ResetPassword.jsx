// src/pages/ResetPassword.jsx — v2 split-screen password reset.
// UI only: authAPI.resetPassword flow + token handling unchanged.
import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';
import {
  FloatingField, PasswordStrength, AuthCta, AuthError, AuthSuccess,
} from '../components/auth/AuthControls';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const token = params.get('token') || '';

  // If a stale session token lingers in the browser, clear it on arrival so
  // resetting the password can't silently auto-log-in with the OLD session.
  useEffect(() => { try { logout?.(); } catch (_) { /* noop */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState('idle');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!token) setError('Invalid or missing reset token.'); }, [token]);

  const mismatch = confirm && confirm !== password;
  const tooShort = password && password.length < 8;

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); setState('error'); return; }
    if (password !== confirm) { setError('Passwords do not match'); setState('error'); return; }
    setState('loading'); setError('');
    try {
      await authAPI.resetPassword(token, password);
      setState('success');
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed. Token may have expired.');
      setState('error');
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        {success ? (
          <AuthSuccess icon={ShieldCheck} title="Password updated!">
            Your password has been reset. Redirecting to sign in…
          </AuthSuccess>
        ) : (
          <>
            <div
              aria-hidden="true"
              style={{
                width: 44, height: 44, borderRadius: 12, marginBottom: 16,
                background: 'color-mix(in srgb, var(--cyan) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--cyan) 22%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--cyan)',
              }}
            >
              <KeyRound size={19} />
            </div>
            <h2>Choose a new password</h2>
            <p className="auth-card-sub">Pick something strong — 12+ characters with numbers and capitals.</p>

            <AuthError>{error}</AuthError>

            <form onSubmit={handleSubmit} noValidate>
              <FloatingField
                label="New password"
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
                label="Confirm new password"
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
                loadingText="Updating…"
                successText="Password updated"
                disabled={!token || !!mismatch}
              >
                Reset Password
              </AuthCta>
            </form>
          </>
        )}

        <p className="auth-fineprint" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <Link to="/login" className="auth-link muted">Back to Sign In</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
