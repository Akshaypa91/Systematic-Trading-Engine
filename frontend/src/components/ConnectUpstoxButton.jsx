// src/components/ConnectUpstoxButton.jsx
// Starts the Upstox OAuth flow through an AUTHENTICATED request, so the backend
// can bind the resulting broker session to this user. Replaces the old
// `<a href=".../upstox/login">` links: an anchor carries no Authorization
// header, so the server had no idea who was linking and the token ended up
// shared across every account.
import { useState } from 'react';
import { authAPI } from '../services/api';
import { PlugZap, Loader2 } from 'lucide-react';

export default function ConnectUpstoxButton({ label = 'Connect Upstox', style, size = 13 }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  async function connect() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await authAPI.upstoxLinkUrl();
      const url = r.data?.url;
      if (!url) throw new Error('No authorize URL returned');
      window.location.href = url;          // hand off to Upstox
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Could not start Upstox login');
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
      <button
        onClick={connect}
        disabled={busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 8,
          background: 'color-mix(in srgb, var(--green) 15%, transparent)',
          border: '1px solid color-mix(in srgb, var(--green) 38%, transparent)',
          color: 'var(--green)', fontWeight: 700, fontSize: 12.5,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
          ...style,
        }}
      >
        {busy ? <Loader2 size={size} className="animate-spin" /> : <PlugZap size={size} />}
        {busy ? 'Redirecting…' : label}
      </button>
      {err && <span style={{ fontSize: 10.5, color: 'var(--red)' }}>{err}</span>}
    </div>
  );
}
