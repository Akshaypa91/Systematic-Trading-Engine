// src/components/auth/AuthControls.jsx
// Form primitives for the auth flow: floating-label field, stateful CTA,
// password strength meter, divider, Google slot. Presentational only.
import { useId, useState } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Check } from 'lucide-react';

/* ── Floating-label input ──────────────────────────────────────────────────── */
export function FloatingField({
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  error,          // string — shows message + red state
  hint,           // string — neutral helper below
  revealable = false, // adds show/hide for passwords
  autoComplete,
  inputMode,
  name,
  required,
  disabled,
  children,       // extra content below input (e.g. strength meter)
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const actualType = revealable ? (show ? 'text' : 'password') : type;

  return (
    <div className={`ff${Icon ? '' : ' no-icon'}`} data-invalid={error ? 'true' : 'false'}>
      <div style={{ position: 'relative' }}>
        {Icon && <span className="ff-icon"><Icon size={15} aria-hidden="true" /></span>}
        <input
          id={id}
          name={name}
          className={`ff-input${Icon ? '' : ' no-icon'}`}
          type={actualType}
          value={value}
          onChange={onChange}
          placeholder=" "
          autoComplete={autoComplete}
          inputMode={inputMode}
          required={required}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          style={revealable ? { paddingRight: 46 } : undefined}
        />
        <label className="ff-label" htmlFor={id}>{label}</label>
        {revealable && (
          <button
            type="button"
            className="ff-trail"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            tabIndex={0}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {error && (
        <span className="ff-msg" id={`${id}-err`} role="alert">
          <AlertCircle size={11} aria-hidden="true" /> {error}
        </span>
      )}
      {!error && hint && (
        <span className="ff-msg ok" id={`${id}-hint`}>
          <CheckCircle2 size={11} aria-hidden="true" /> {hint}
        </span>
      )}
      {children}
    </div>
  );
}

/* ── Password strength (same thresholds the reset page used) ──────────────── */
export function passwordStrength(password) {
  if (!password) return 0;
  if (password.length < 8) return 1;
  if (password.length < 12) return 2;
  return /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLOR = ['', 'var(--red)', 'var(--amber)', 'var(--cyan)', 'var(--green)'];

export function PasswordStrength({ password }) {
  const s = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="pw-meter" aria-live="polite">
      <div className="pw-meter-track" role="img" aria-label={`Password strength: ${STRENGTH_LABEL[s]}`}>
        {[1, 2, 3, 4].map((seg) => (
          <span
            key={seg}
            className="pw-meter-seg"
            style={seg <= s ? { background: STRENGTH_COLOR[s] } : undefined}
          />
        ))}
      </div>
      <span className="pw-meter-label" style={{ color: STRENGTH_COLOR[s] }}>{STRENGTH_LABEL[s]}</span>
    </div>
  );
}

/* ── Stateful CTA: idle | loading | success | error ───────────────────────── */
export function AuthCta({ state = 'idle', children, successText = 'Success', loadingText, ...rest }) {
  const busy = state === 'loading';
  return (
    <button
      type="submit"
      className="auth-cta"
      data-state={state}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {state === 'loading' && <><span className="cta-spinner" aria-hidden="true" />{loadingText || 'Please wait…'}</>}
      {state === 'success' && <><Check size={16} aria-hidden="true" />{successText}</>}
      {(state === 'idle' || state === 'error') && children}
    </button>
  );
}

/* ── Divider ──────────────────────────────────────────────────────────────── */
export function AuthDivider({ children = 'OR CONTINUE WITH EMAIL' }) {
  return <div className="auth-divider" role="separator"><span>{children}</span></div>;
}

/* ── Google slot: alignment + loading veil around the OAuth iframe ────────── */
export function GoogleSlot({ busy, children }) {
  return (
    <div className="auth-google" data-busy={busy ? 'true' : 'false'}>
      {children}
      {busy && (
        <span className="auth-google-veil" aria-live="polite">
          <span className="cta-spinner" style={{ borderColor: 'color-mix(in srgb, var(--cyan) 30%, transparent)', borderTopColor: 'var(--cyan)' }} />
        </span>
      )}
    </div>
  );
}

/* ── Error banner ─────────────────────────────────────────────────────────── */
export function AuthError({ children }) {
  if (!children) return null;
  return (
    <div className="auth-banner error" role="alert">
      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ── Success screen ───────────────────────────────────────────────────────── */
export function AuthSuccess({ icon: Icon = CheckCircle2, title, children }) {
  return (
    <div className="auth-success" role="status">
      <div className="auth-success-icon"><Icon size={28} aria-hidden="true" /></div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
