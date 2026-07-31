// src/components/BrokerConnectBanner.jsx
// Compact broker connect/disconnect strip for pages that aren't the Trade
// page (e.g. the Dashboard). Not linked → "Connect Upstox" CTA. Linked →
// connected chip + Disconnect (with confirmation; uses the existing
// POST /api/auth/upstox/logout endpoint). Shared TradingMode context keeps
// the navbar mode selector and LIVE guard in sync.
import { useState } from 'react';
import { PlugZap, Link2, Unplug, Loader2, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTradingMode } from '../context/TradingModeContext';
import { authAPI } from '../services/api';
import ConnectUpstoxButton from './ConnectUpstoxButton';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

export default function BrokerConnectBanner({ style }) {
  const { brokerLinked, loading, reportBroker, refresh, mode } = useTradingMode();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (loading) return null;

  async function disconnect() {
    setBusy(true); setError('');
    try {
      await authAPI.upstoxLogout();
      reportBroker(false);           // forces PAPER if currently LIVE
      refresh();
      setConfirming(false);
    } catch (e) {
      setError(e.response?.data?.error || 'Disconnect failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (brokerLinked) {
    return (
      <>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '5px 6px 5px 12px', borderRadius: 99,
          background: 'color-mix(in srgb, var(--green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 32%, transparent)', ...style }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Link2 size={12} style={{ color: 'var(--green)' }} />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>Upstox connected</span>
          </span>
          <button
            onClick={() => setConfirming(true)}
            title="Disconnect Upstox"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 99, cursor: 'pointer',
              fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-mono)',
              background: 'transparent', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)' }}
          >
            <Unplug size={11} /> Disconnect
          </button>
        </div>

        {confirming && createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" style={{ maxWidth: 380, padding: 24, margin: 16, border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <AlertTriangle size={18} style={{ color: 'var(--red)', flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Disconnect Upstox?</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
                This unlinks your broker session. Live market data and real-money
                trading will stop{mode === 'LIVE' ? ', and trading mode will switch back to PAPER' : ''}.
                You can reconnect anytime.
              </p>
              {error && (
                <p className="font-mono" style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{error}</p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button onClick={() => { setConfirming(false); setError(''); }} disabled={busy}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  Keep connected
                </button>
                <button onClick={disconnect} disabled={busy}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: 'color-mix(in srgb, var(--red) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)', color: 'var(--red)' }}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />} Disconnect
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 10, marginBottom: 16,
      background: 'color-mix(in srgb, var(--green) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 26%, transparent)', ...style }}>
      <PlugZap size={16} style={{ color: 'var(--green)' }} />
      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        Connect your Upstox account to enable live market data and real-money trading.
      </span>
      <div style={{ marginLeft: 'auto' }}>
        <ConnectUpstoxButton />
      </div>
    </div>
  );
}
