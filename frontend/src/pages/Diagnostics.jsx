// src/pages/Diagnostics.jsx — Developer market-data diagnostics
// WebSocket status, tick rate, latency, subscribed symbols, last tick,
// reconnect count, and the currently-active data provider. Polls the backend
// diagnostics endpoint (this page is the one place a short poll is appropriate).
import { useState, useEffect, useRef, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { liveAPI } from '../services/api';
import { useWS } from '../context/WSContext';
import { Activity, Radio, Gauge, RefreshCw, Wifi, WifiOff } from 'lucide-react';

const PROVIDER_LABEL = {
  UPSTOX_WS: 'Upstox WebSocket (live)',
  'UPSTOX/FALLBACK': 'Upstox (fallback/REST)',
  SIM: 'Simulated (no broker)',
};

function Metric({ label, value, color, mono = true }) {
  return (
    <div className="card" style={{ padding: 14, flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{value}</div>
    </div>
  );
}

export default function Diagnostics() {
  const { status: wsClientStatus } = useWS();
  const [diag, setDiag] = useState(null);
  const [latency, setLatency] = useState(null);

  const load = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await liveAPI.diagnostics();
      setLatency(Math.round(performance.now() - t0));
      setDiag(res.data);
    } catch { /* leave last */ }
  }, []);

  const ref = useRef();
  useEffect(() => { load(); ref.current = setInterval(load, 5000); return () => clearInterval(ref.current); }, [load]);

  const ws = diag?.websocket || {};
  const connected = !!ws.connected;
  const provider = diag?.provider || (diag?.brokerAuthenticated ? 'UPSTOX/FALLBACK' : 'SIM');
  const isFallback = provider === 'UPSTOX/FALLBACK';

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Activity size={18} style={{ color: 'var(--cyan)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Market Data Diagnostics</h1>
            <button onClick={load} className="ws-pill" style={{ marginLeft: 'auto', cursor: 'pointer' }}><RefreshCw size={11} /> Refresh</button>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Live WebSocket diagnostics · 2s poll</p>

          {/* Provider banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, marginBottom: 16,
            background: `color-mix(in srgb, ${connected ? 'var(--green)' : isFallback ? 'var(--amber)' : 'var(--text-muted)'} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${connected ? 'var(--green)' : isFallback ? 'var(--amber)' : 'var(--border)'} 30%, transparent)` }}>
            {connected ? <Wifi size={16} style={{ color: 'var(--green)' }} /> : <WifiOff size={16} style={{ color: 'var(--amber)' }} />}
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Provider: {PROVIDER_LABEL[provider] || provider}
            </span>
            {isFallback && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>⚠ FALLBACK MARKET DATA</span>}
          </div>

          {/* Metrics grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <Metric label="WS (backend→Upstox)" value={connected ? 'CONNECTED' : 'DOWN'} color={connected ? 'var(--green)' : 'var(--red)'} />
            <Metric label="WS (browser→backend)" value={wsClientStatus === 'connected' ? 'CONNECTED' : wsClientStatus.toUpperCase()} color={wsClientStatus === 'connected' ? 'var(--green)' : 'var(--amber)'} />
            <Metric label="Tick Rate" value={`${ws.tickRate ?? 0}/s`} color="var(--cyan)" />
            <Metric label="Total Ticks" value={(ws.tickCount ?? 0).toLocaleString('en-IN')} />
            <Metric label="Latency (API)" value={latency != null ? `${latency} ms` : '—'} />
            <Metric label="Reconnects" value={ws.reconnectCount ?? 0} color={ws.reconnectCount ? 'var(--amber)' : 'var(--text-primary)'} />
            <Metric label="Subscribed" value={ws.subscribedCount ?? 0} />
            <Metric label="Cached Prices" value={ws.cachedPrices ?? 0} />
          </div>

          {/* Detail */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Radio size={13} style={{ color: 'var(--cyan)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Session</span>
              </div>
              {[
                ['Broker authenticated', diag?.brokerAuthenticated ? 'Yes' : 'No'],
                ['Connected at', ws.connectedAt ? new Date(ws.connectedAt).toLocaleTimeString('en-IN', { hour12: false }) : '—'],
                ['Last tick', ws.lastTickTs ? new Date(ws.lastTickTs).toLocaleTimeString('en-IN', { hour12: false }) : '—'],
                ['Feed clients', diag?.feed?.connectedClients ?? '—'],
                ['Active subscriptions', diag?.feed?.activeSubscriptions ?? '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Gauge size={13} style={{ color: 'var(--cyan)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Subscribed Instruments</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {(diag?.feed?.watchedSymbols?.length ? diag.feed.watchedSymbols : (ws.subscribedKeys || [])).slice(0, 60).map((s, i) => (
                  <span key={i} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    {String(s).replace('NSE_EQ|', '')}
                  </span>
                ))}
                {!(diag?.feed?.watchedSymbols?.length) && !(ws.subscribedKeys?.length) && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No active subscriptions</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
