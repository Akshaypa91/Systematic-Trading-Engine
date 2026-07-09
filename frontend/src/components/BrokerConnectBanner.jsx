// src/components/BrokerConnectBanner.jsx
// Compact broker-connect strip for pages that aren't the Trade page (e.g. the
// Dashboard). Shows a "Connect Upstox" CTA when the broker isn't linked, and a
// slim "connected" chip when it is. Uses the shared TradingMode context.
import { PlugZap, Link2 } from 'lucide-react';
import { useTradingMode } from '../context/TradingModeContext';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3000';

export default function BrokerConnectBanner({ style }) {
  const { brokerLinked, loading } = useTradingMode();
  if (loading) return null;

  if (brokerLinked) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 99,
        background: 'color-mix(in srgb, var(--green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 32%, transparent)', ...style }}>
        <Link2 size={12} style={{ color: 'var(--green)' }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>Upstox connected</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 10, marginBottom: 16,
      background: 'color-mix(in srgb, var(--green) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 26%, transparent)', ...style }}>
      <PlugZap size={16} style={{ color: 'var(--green)' }} />
      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        Connect your Upstox account to enable live market data and real-money trading.
      </span>
      <a href={`${API_BASE}/api/auth/upstox/login`}
        style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 8,
          background: 'color-mix(in srgb, var(--green) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 38%, transparent)',
          color: 'var(--green)', fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>
        <PlugZap size={13} /> Connect Upstox
      </a>
    </div>
  );
}
