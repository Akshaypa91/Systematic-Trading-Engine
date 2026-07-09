// src/components/LiveModeBanner.jsx — Phase 1 (Live Trading)
// Prominent top banner shown ONLY while the app is in LIVE (real money) mode.
// Summarises the connected broker, account, funds, market status, and latency
// so the operator always knows real money is at stake.
import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { liveAPI } from '../services/api';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { inrCompact } from '../utils/format';

export default function LiveModeBanner({ active }) {
  const [broker, setBroker] = useState(null);
  const { marketStatus, backend } = useSystemStatus();

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const load = () => liveAPI.brokerStatus().then(r => { if (alive) setBroker(r.data); }).catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [active]);

  if (!active) return null;

  const funds   = broker?.funds?.available;
  const account = broker?.profile?.accountName || broker?.profile?.clientId || '—';
  const items = [
    { k: 'Broker',  v: broker?.connected ? (broker?.broker || 'Upstox') : 'Disconnected' },
    { k: 'Account', v: account },
    { k: 'Funds',   v: funds != null ? `₹${inrCompact(funds)}` : '—' },
    { k: 'Market',  v: marketStatus?.status || '—' },
    { k: 'Latency', v: backend?.latencyMs != null ? `${backend.latencyMs}ms` : '—' },
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '9px 16px', marginBottom: 14, borderRadius: 10,
      background: 'linear-gradient(90deg, color-mix(in srgb, var(--green) 16%, transparent), color-mix(in srgb, var(--green) 6%, transparent))',
      border: '1px solid color-mix(in srgb, var(--green) 42%, transparent)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="live-dot" style={{ width: 8, height: 8, background: 'var(--green)' }} />
        <Zap size={14} style={{ color: 'var(--green)' }} />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--green)', letterSpacing: '0.03em' }}>🟢 LIVE TRADING</div>
          <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Real Money Enabled</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginLeft: 'auto' }}>
        {items.map(({ k, v }) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{k}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
