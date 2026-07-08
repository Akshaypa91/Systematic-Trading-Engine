// src/pages/ForgotPassword.jsx — v2 split-screen reset request.
// UI only: authAPI.forgotPassword flow (incl. the dev-token affordance)
// unchanged. Adds an animated email-sent success screen.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import { Mail, MailCheck, ArrowLeft } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';
import {
  FloatingField, AuthCta, AuthError, AuthSuccess,
} from '../components/auth/AuthControls';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [devToken, setDevToken] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email) { setError('Email is required'); setState('error'); return; }
    setState('loading'); setError('');
    try {
      const res = await authAPI.forgotPassword(email);
      setState('success');
      setSent(true);
      if (res.data._devToken) setDevToken(res.data._devToken);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
      setState('error');
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        {sent ? (
          <>
            <AuthSuccess icon={MailCheck} title="Check your email">
              If <strong style={{ color: 'var(--text-secondary)' }}>{email}</strong> is registered,
              you&apos;ll receive a password reset link shortly.
            </AuthSuccess>

            {devToken && (
              <div
                className="auth-banner"
                style={{
                  marginTop: 18,
                  background: 'color-mix(in srgb, var(--amber) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--amber) 22%, transparent)',
                  flexDirection: 'column', alignItems: 'stretch', gap: 6,
                }}
              >
                <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10 }}>DEV MODE — Reset token</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 10, wordBreak: 'break-all' }}>{devToken}</span>
                <Link to={`/reset-password?token=${devToken}`} className="auth-link" style={{ fontSize: 11 }}>
                  → Use this token to reset
                </Link>
              </div>
            )}
          </>
        ) : (
          <>
            <h2>Reset password</h2>
            <p className="auth-card-sub">
              Enter the email tied to your account and we&apos;ll send you a reset link.
            </p>

            <AuthError>{error}</AuthError>

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
              <AuthCta
                state={state === 'error' ? 'error' : state}
                loadingText="Sending link…"
                successText="Link sent"
              >
                Send Reset Link
              </AuthCta>
            </form>
          </>
        )}

        <p className="auth-fineprint" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <Link to="/login" className="auth-link muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={12} aria-hidden="true" /> Back to Sign In
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
