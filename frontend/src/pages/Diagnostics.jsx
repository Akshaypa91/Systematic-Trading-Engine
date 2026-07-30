// src/pages/Diagnostics.jsx — Developer market-data diagnostics
// WebSocket status, tick rate, latency, subscribed symbols, last tick,
// reconnect count, and the currently-active data provider. Polls the backend
// diagnostics endpoint (this page is the one place a short poll is appropriate).
import { useState, useEffect, useRef, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { liveAPI } from '../services/api';
import { useWS } from '../context/WSContext';
import { Activity, Radio, Gauge, RefreshCw, Wifi, WifiOff, Info } from 'lucide-react';

const PROVIDER_LABEL = {
  UPSTOX_WS: 'Upstox WebSocket (streaming)',
  UPSTOX_REST: 'Upstox REST poller (live)',
  'UPSTOX/FALLBACK': 'Upstox (on-demand REST)',
  SIM: 'Simulated (no broker)',
};

function fmtUptime(s) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

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

  const ws   = diag?.websocket || {};
  const rest = diag?.restFeed  || {};
  const connected = !!ws.connected;
  const provider = diag?.provider || (diag?.brokerAuthenticated ? 'UPSTOX/FALLBACK' : 'SIM');
  const isFallback = provider === 'UPSTOX/FALLBACK';
  // The WS ships disabled by default (UPSTOX_WS_ENABLED) — "DOWN" would imply a
  // fault, so distinguish an intentional off state from an actual failure.
  const wsDisabled = ws.enabled === false;
  const wsLabel = wsDisabled ? 'DISABLED' : connected ? 'CONNECTED' : 'DOWN';
  const wsColor = wsDisabled ? 'var(--text-muted)' : connected ? 'var(--green)' : 'var(--red)';
  // Report metrics for whichever feed is ACTUALLY serving prices, so the page
  // doesn't show all-zero WS counters while the REST poller is doing the work.
  const restActive = !connected && (rest.running || provider === 'UPSTOX_REST');
  const feed = restActive ? rest : ws;
  const feedName = restActive ? 'REST poller' : 'WebSocket';
  const subscribedList = restActive
    ? (rest.subscribed || [])
    : (diag?.feed?.watchedSymbols?.length ? diag.feed.watchedSymbols : (ws.subscribedKeys || []));
  const missingSymbols = restActive ? (rest.missingSymbols || []) : [];

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Activity size={18} style={{ color: 'var(--cyan)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Market Data Diagnostics</h1>
            <button onClick={load} className="ws-pill" style={{ marginLeft: 'auto', cursor: 'pointer' }}><RefreshCw size={11} /> Refresh</button>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Live WebSocket diagnostics · 5s poll</p>

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

          {/* Host restarts silently reset in-memory state and stop the OMS loop —
              surface it, since on a sleeping instance it's easy to miss. */}
          {diag?.process?.recentlyRestarted && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', borderRadius: 9, marginBottom: 16,
              background: 'color-mix(in srgb, var(--amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)' }}>
              <Info size={13} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Backend restarted <b>{fmtUptime(diag.process.uptimeSec)}</b> ago. Frequent restarts (free-tier
                sleep) reset tick counters and <b>halt the live execution loop</b> — not safe for autonomous trading.
              </span>
            </div>
          )}

          {/* The WS ships off by default — explain rather than look broken. */}
          {wsDisabled && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', borderRadius: 9, marginBottom: 16,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <Info size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                The Upstox streaming WebSocket is <b>intentionally disabled</b> (<code style={{ fontFamily: 'var(--font-mono)' }}>UPSTOX_WS_ENABLED</code> is not
                set), so prices come from the REST poller — this is the expected, working configuration.
                Enable the flag only after verifying a live tick. See TRADING.md.
              </span>
            </div>
          )}

          {/* Metrics grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <Metric label="WS (backend→Upstox)" value={wsLabel} color={wsColor} />
            <Metric label="WS (browser→backend)" value={wsClientStatus === 'connected' ? 'CONNECTED' : wsClientStatus.toUpperCase()} color={wsClientStatus === 'connected' ? 'var(--green)' : 'var(--amber)'} />
            <Metric label={`Tick Rate (${feedName})`} value={`${feed.tickRate ?? 0}/s`} color="var(--cyan)" />
            <Metric label="Total Ticks" value={(feed.tickCount ?? 0).toLocaleString('en-IN')} />
            <Metric label="Latency (API)" value={latency != null ? `${latency} ms` : '—'} />
            <Metric label="Reconnects" value={ws.reconnectCount ?? 0} color={ws.reconnectCount ? 'var(--amber)' : 'var(--text-primary)'} />
            <Metric label="Subscribed" value={restActive ? (rest.subscribed?.length ?? 0) : (ws.subscribedCount ?? 0)} />
            <Metric label="Cached Prices" value={feed.cachedPrices ?? 0} />
          </div>

          {/* Measured reaction budget — the honest answer to "how fast are we?" */}
          {diag?.latency?.reaction && (
            <div className="card" style={{ padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Gauge size={13} style={{ color: 'var(--cyan)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Reaction Latency</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  median, {diag.latency.sampleWindow}-sample window
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                {[
                  ['Feed staleness', diag.latency.reaction.breakdown.feed_age],
                  ['Signal compute', diag.latency.reaction.breakdown.signal_calc],
                  ['Order round-trip', diag.latency.reaction.breakdown.order_place],
                  ['TOTAL REACTION', diag.latency.reaction.totalMs],
                ].map(([label, ms], i) => (
                  <div key={label} style={{ flex: 1, minWidth: 130 }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: i === 3 ? 19 : 15, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: i === 3 ? 'var(--amber)' : 'var(--text-primary)' }}>
                      {ms == null ? '—' : `${ms} ms`}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {diag.latency.reaction.note}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5, fontFamily: 'var(--font-mono)' }}>
                  {diag.latency.reaction.classification} · HFT reference: {diag.latency.reaction.hftReferenceMicroseconds} µs
                </div>
              </div>
            </div>
          )}

          {/* Detail */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Radio size={13} style={{ color: 'var(--cyan)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Session</span>
              </div>
              {[
                ['Broker authenticated', diag?.brokerAuthenticated ? 'Yes' : 'No'],
                ['Server uptime', diag?.process ? fmtUptime(diag.process.uptimeSec) : '—'],
                ['Active feed', restActive
                  ? `REST poller (${rest.pollMs ?? '—'}ms${rest.marketOpen === false ? ', idle' : ''})`
                  : (wsDisabled ? 'WebSocket disabled' : 'WebSocket')],
                ['Connected at', ws.connectedAt ? new Date(ws.connectedAt).toLocaleTimeString('en-IN', { hour12: false }) : '—'],
                ['Last tick', feed.lastTickTs ? new Date(feed.lastTickTs).toLocaleTimeString('en-IN', { hour12: false }) : '—'],
                ['Feed clients', diag?.feed?.connectedClients ?? '—'],
                ['Active subscriptions', diag?.feed?.activeSubscriptions ?? '—'],
                ['Last feed error', rest.lastError ? String(rest.lastError).slice(0, 40) : '—'],
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
                {subscribedList.slice(0, 60).map((s, i) => {
                  // Amber = subscribed but no price cached (upstream omission or bad key).
                  const noPrice = missingSymbols.includes(s);
                  return (
                    <span key={i} title={noPrice ? 'No price received for this instrument' : undefined}
                      style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 6,
                        background: noPrice ? 'color-mix(in srgb, var(--amber) 10%, transparent)' : 'var(--bg-elevated)',
                        border: `1px solid ${noPrice ? 'color-mix(in srgb, var(--amber) 32%, transparent)' : 'var(--border)'}`,
                        color: noPrice ? 'var(--amber)' : 'var(--text-secondary)' }}>
                      {String(s).replace('NSE_EQ|', '')}{noPrice ? ' ⚠' : ''}
                    </span>
                  );
                })}
                {subscribedList.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    No active subscriptions{!diag?.brokerAuthenticated ? ' — connect Upstox' : ' — the poller subscribes on demand'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
