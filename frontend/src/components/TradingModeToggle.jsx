// TradingModeToggle.jsx — PAPER / LIVE mode switcher
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, Zap, AlertTriangle } from 'lucide-react';

export default function TradingModeToggle({ mode, brokerLinked, onChange, disabled }) {
  const [confirming, setConfirming] = useState(false);
  const isLive = mode === 'LIVE';

  function handleClick() {
    if (!isLive) {
      if (!brokerLinked) return;   // button disabled if not linked
      setConfirming(true);
    } else {
      onChange('PAPER');
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 font-mono" style={{ fontSize: 11 }}>
        {/* PAPER pill — Blue */}
        <button onClick={() => !isLive ? null : onChange('PAPER')}
          style={{
            padding: '4px 12px', borderRadius: 99, cursor: isLive ? 'pointer' : 'default',
            background: !isLive ? 'color-mix(in srgb, var(--blue, var(--cyan)) 14%, transparent)' : 'transparent',
            border: `1px solid ${!isLive ? 'color-mix(in srgb, var(--blue, var(--cyan)) 45%, transparent)' : 'var(--border)'}`,
            color: !isLive ? 'var(--blue, var(--cyan))' : 'var(--text-muted)',
            fontWeight: !isLive ? 700 : 400,
          }}>
          <div className="flex items-center gap-1.5">
            <Shield size={10} /> <span className="tmt-label">PAPER</span>
          </div>
        </button>

        {/* LIVE pill — Green (real money) */}
        <button onClick={handleClick} disabled={disabled || (!brokerLinked && !isLive)}
          title={!brokerLinked ? 'Connect Upstox to enable live trading' : ''}
          style={{
            padding: '4px 12px', borderRadius: 99,
            cursor: disabled || (!brokerLinked && !isLive) ? 'not-allowed' : 'pointer',
            opacity: !brokerLinked && !isLive ? 0.4 : 1,
            background: isLive ? 'color-mix(in srgb, var(--green) 16%, transparent)' : 'transparent',
            border: `1px solid ${isLive ? 'color-mix(in srgb, var(--green) 55%, transparent)' : 'var(--border)'}`,
            color: isLive ? 'var(--green)' : 'var(--text-muted)',
            fontWeight: isLive ? 700 : 400,
          }}>
          <div className="flex items-center gap-1.5">
            {isLive && <span className="live-dot" style={{ width: 5, height: 5, background: 'var(--green)' }} />}
            <Zap size={10} /> <span className="tmt-label">LIVE</span>
          </div>
        </button>

        {/* Real-money reminder — compact single-line, amber (caution, not
            "all good" green), shown only while LIVE. The mode toggle already
            says LIVE; this adds the one fact the toggle doesn't: money is real. */}
        {isLive && (
          <span className="nb-md-up" title="LIVE account — orders use real money" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99,
            background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--amber) 38%, transparent)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--amber)',
          }}>
            ₹ REAL MONEY
          </span>
        )}
      </div>

      {/* Switch-to-LIVE confirmation — portaled to <body>: the navbar's
          backdrop-filter creates a containing block that traps fixed
          descendants, which rendered this dialog inline at the page top. */}
      {confirming && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ maxWidth: 380, padding: 24, margin: 16, border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)' }}>
            <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
              <AlertTriangle size={20} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                Switch to LIVE Trading?
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              All orders placed in LIVE mode will use <strong>real money</strong> via your
              connected broker. You will be shown a confirmation before every order.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                Stay on Paper
              </button>
              <button onClick={() => { onChange('LIVE'); setConfirming(false); }}
                className="flex-1 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'color-mix(in srgb, var(--red) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)', color: 'var(--red)' }}>
                Switch to LIVE
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
