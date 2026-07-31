// src/components/BrokerStatusCard.jsx — Phase 1 (Live Trading)
// ─────────────────────────────────────────────────────────────────────────────
// Replaces the old "Connect Upstox" pill. Shows the real Upstox broker
// connection: identity, funds/margin/equity, segment, connection time, and
// token expiry, with Reconnect / Disconnect / Refresh actions.
//
// Read-only in Phase 1 (no order placement). Reports connection state upward
// via onStatusChange so the parent can gate LIVE mode: if disconnected, LIVE
// must be disabled.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Link2, Link2Off, RefreshCw, PlugZap, Wallet, ShieldCheck, Clock3, AlertTriangle,
} from 'lucide-react';
import { liveAPI } from '../services/api';
import { inr, colorOf } from '../utils/format';
import ConnectUpstoxButton from './ConnectUpstoxButton';

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { hour12: false, dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return '—'; }
}

// Token expiry urgency: red once expired, amber inside the final 6 hours,
// neutral otherwise (it was hard-coded amber, which read as a warning 24/7).
function expiryColor(iso) {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return undefined;
  if (ms <= 0) return 'var(--red)';
  if (ms < 6 * 60 * 60 * 1000) return 'var(--amber)';
  return undefined;
}

function Row({ label, value, mono = true, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.03em' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: color || 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

export default function BrokerStatusCard({ onStatusChange }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);   // 'reconnect' | 'disconnect' | 'refresh'
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await liveAPI.brokerStatus();
      setData(res.data);
      setError(null);
      // Definitive answer from the server — safe to act on.
      onStatusChange?.(!!res.data?.connected);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load broker status');
      // We could NOT determine the broker state (cold start, 429, network blip).
      // Reporting `false` here would force LIVE→PAPER and persist it, silently
      // demoting the user on any transient error. Report "unknown" instead.
      onStatusChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);   // keep funds/expiry fresh
    return () => clearInterval(id);
  }, [load]);

  async function act(kind) {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'reconnect') await liveAPI.brokerReconnect();
      if (kind === 'disconnect') await liveAPI.brokerDisconnect();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || `${kind} failed`);
    } finally {
      setBusy(null);
    }
  }

  const connected = !!data?.connected;
  const profile   = data?.profile || {};
  const funds     = data?.funds || {};
  const accent    = connected ? 'var(--green)' : 'var(--text-muted)';

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: `1px solid ${connected ? 'color-mix(in srgb, var(--green) 30%, transparent)' : 'var(--border)'}` }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
        background: connected ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${accent} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
        }}>
          {connected ? <Link2 size={15} style={{ color: accent }} /> : <Link2Off size={15} style={{ color: accent }} />}
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {data?.broker || 'Upstox'}
          </div>
          <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: accent, fontWeight: 700, letterSpacing: '0.05em' }}>
            {loading ? 'CHECKING…' : connected ? '● CONNECTED' : '● DISCONNECTED'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => act('refresh')} disabled={busy != null} title="Refresh"
            className="btn-ghost-sm" style={btnStyle}>
            <RefreshCw size={12} className={busy === 'refresh' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 16px 14px' }}>
        {!connected && !loading ? (
          <div style={{ textAlign: 'center', padding: '18px 8px' }}>
            <p style={{ fontSize: 12, color: data?.tokenRejected ? 'var(--amber)' : 'var(--text-secondary)', marginBottom: 14 }}>
              {data?.linkedByOther
                ? 'Another account has linked a broker on this deployment. Connect your own Upstox account to trade — you cannot see or use theirs.'
                : (data?.reason || 'No active Upstox session. Connect to enable live market data and LIVE trading.')}
            </p>
            <ConnectUpstoxButton size={14} style={{ padding: '8px 16px' }} />
          </div>
        ) : (
          <>
            <SectionHead icon={ShieldCheck} label="Account" />
            <Row label="Client ID"    value={profile.clientId} />
            <Row label="Account Name" value={profile.accountName} mono={false} />
            <Row label="Segment"      value={profile.segment} />

            <div style={{ height: 10 }} />
            <SectionHead icon={Wallet} label="Funds" />
            {/* Sign-driven colors — a negative balance must never render green */}
            <Row label="Available Funds" value={funds.available != null ? inr(funds.available, { decimals: 2 }) : '—'}
                 color={funds.available != null ? colorOf(funds.available) : undefined} />
            <Row label="Used Margin"     value={funds.used != null ? inr(funds.used, { decimals: 2 }) : '—'}
                 color={funds.used > 0 ? 'var(--amber)' : undefined} />
            <Row label="Equity"          value={funds.equity != null ? inr(funds.equity, { decimals: 2 }) : '—'}
                 color={funds.equity != null ? colorOf(funds.equity) : undefined} />

            <div style={{ height: 10 }} />
            <SectionHead icon={Clock3} label="Session" />
            <Row label="Connection Time" value={fmtTime(data?.connectionTime)} />
            <Row label="Token Expiry"    value={fmtTime(data?.tokenExpiry)} color={expiryColor(data?.tokenExpiry)} />
            <Row label="WebSocket"       value={data?.websocket?.connected ? 'Live' : 'Down'} color={data?.websocket?.connected ? 'var(--green)' : 'var(--red)'} />

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => act('reconnect')} disabled={busy != null} style={{ ...actionBtn, color: 'var(--cyan)', borderColor: 'color-mix(in srgb, var(--cyan) 34%, transparent)' }}>
                <RefreshCw size={12} className={busy === 'reconnect' ? 'animate-spin' : ''} /> Reconnect
              </button>
              <button onClick={() => act('disconnect')} disabled={busy != null} style={{ ...actionBtn, color: 'var(--red)', borderColor: 'color-mix(in srgb, var(--red) 34%, transparent)' }}>
                <Link2Off size={12} /> Disconnect
              </button>
            </div>
          </>
        )}

        {(error || data?.errors?.funds || data?.errors?.profile) && (
          <div style={{ marginTop: 12, display: 'flex', gap: 7, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 7, background: 'color-mix(in srgb, var(--red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 24%, transparent)' }}>
            <AlertTriangle size={13} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 10.5, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
              {error || data?.errors?.funds || data?.errors?.profile}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHead({ icon: Icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <Icon size={11} style={{ color: 'var(--text-muted)' }} />
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

const btnStyle = {
  width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
};

const actionBtn = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
};
