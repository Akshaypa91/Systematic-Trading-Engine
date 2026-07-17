// src/components/RealMoneyArmModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Real-money safety interlock. Before the first live order of a session, the
// user must type CONFIRM to "arm" real-money order placement. This is a
// deliberate friction step — placing a live order sends a REAL Upstox order and
// can move real money. Arming lasts for the browser session only (see
// TradingModeContext); leaving LIVE or disconnecting the broker disarms it.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';

const CONFIRM_WORD = 'CONFIRM';

export default function RealMoneyArmModal({ open, sandbox = false, onArm, onCancel }) {
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  if (!open) return null;

  const ready = text.trim().toUpperCase() === CONFIRM_WORD;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 440, width: '100%', padding: 24,
        border: `1px solid color-mix(in srgb, var(--red) 45%, transparent)` }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <AlertTriangle size={19} style={{ color: 'var(--red)', flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Arm real-money trading</span>
          <button onClick={onCancel} title="Cancel"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex' }}>
            <X size={16} />
          </button>
        </div>

        {sandbox ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: 12 }}>
            The backend is in <b style={{ color: 'var(--amber)' }}>SANDBOX</b> mode, so orders route to Upstox's
            test environment — no real money moves yet. This gate is still shown so the flow matches live. Set
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-elevated)', margin: '0 4px' }}>UPSTOX_SANDBOX=false</code>
            on the server to place real orders.
          </p>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.65, marginBottom: 12 }}>
            You're about to enable <b style={{ color: 'var(--red)' }}>real-money order placement</b> through your
            connected Upstox account. Once armed, confirming an order will send a <b>real order</b> to the exchange
            and can move real funds. Start small (1 share) to verify the full path.
          </p>
        )}

        <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>
          <li>Arming lasts for this session only.</li>
          <li>Switching to PAPER or disconnecting disarms it.</li>
          <li>Each order still shows a charges confirmation before it's sent.</li>
        </ul>

        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
          Type <span style={{ color: 'var(--red)' }}>{CONFIRM_WORD}</span> to arm
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) onArm(); }}
          placeholder={CONFIRM_WORD}
          spellCheck={false}
          autoComplete="off"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, letterSpacing: '0.12em',
            fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
            border: `1px solid ${ready ? 'color-mix(in srgb, var(--green) 55%, transparent)' : 'var(--border)'}` }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button onClick={ready ? onArm : undefined} disabled={!ready}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'color-mix(in srgb, var(--green) 16%, transparent)',
              border: '1px solid color-mix(in srgb, var(--green) 50%, transparent)', color: 'var(--green)' }}>
            <ShieldCheck size={14} /> Arm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
