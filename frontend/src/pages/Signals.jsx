// src/pages/Signals.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Real-time Signal Center
//   • Primary: WebSocket SIM_TICK / LIVE_SIGNAL events (instant push)
//   • Fallback: simAPI.getSignals() polled every 3s when WS disconnected
//   • Source badge: LIVE | SIM per signal
//   • Full indicator display: RSI, SMA20/50, Bollinger Bands
//   • Auto-trade BUY / SELL buttons on each signal card
//
// Presentation refactored onto the src/components/ui design-system primitives.
// Data flow (WS merge, polling fallback, single-fetch) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import AppShell from '../components/AppShell';
import SignalCard from '../components/SignalCard';
import Toast from '../components/Toast';
import { useWS } from '../context/WSContext';
import { simAPI } from '../services/api';
import { Button, Card, Chip, EmptyState, PageHeader, SectionLabel } from '../components/ui';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw,
  Activity, Wifi, WifiOff, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const POLL_INTERVAL_MS = 3000;
const QUICK_SYMBOLS    = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'WIPRO', 'SBIN', 'AXISBANK'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function mergeSignal(prev, incoming) {
  const idx = prev.findIndex(s => s.symbol === incoming.symbol);
  if (idx === -1) return [incoming, ...prev];
  const next = [...prev];
  next[idx] = incoming;
  return next;
}

function mergeMany(prev, incoming = []) {
  let result = [...prev];
  for (const sig of incoming) result = mergeSignal(result, sig);
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConnectionBadge({ wsStatus, usingPoll }) {
  const live = wsStatus === 'connected' && !usingPoll;
  return (
    <span
      className="ws-pill"
      data-state={live ? 'connected' : 'connecting'}
      style={{
        // ws-pill token classes carry the color; keep explicit state class too
        background: live
          ? 'color-mix(in srgb, var(--green) 10%, transparent)'
          : 'color-mix(in srgb, var(--amber) 10%, transparent)',
        borderColor: live
          ? 'color-mix(in srgb, var(--green) 30%, transparent)'
          : 'color-mix(in srgb, var(--amber) 30%, transparent)',
        color: live ? 'var(--green)' : 'var(--amber)',
        fontWeight: 700,
      }}
    >
      {live ? <Wifi size={10} /> : <WifiOff size={10} />}
      {live ? 'WS LIVE' : 'POLLING 3s'}
    </span>
  );
}

function SummaryBar({ signals = [] }) {
  const safe = Array.isArray(signals) ? signals : [];
  const buys  = safe.filter(s => s.signal === 'BUY').length;
  const sells = safe.filter(s => s.signal === 'SELL').length;
  const holds = safe.filter(s => s.signal === 'HOLD').length;
  const liveCount = safe.filter(s => s.source === 'LIVE').length;

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {[
        { label: 'BUY',  count: buys,  color: 'var(--green)', Icon: TrendingUp },
        { label: 'SELL', count: sells, color: 'var(--red)',   Icon: TrendingDown },
        { label: 'HOLD', count: holds, color: 'var(--amber)', Icon: Minus },
      ].map(({ label, count, color, Icon }) => (
        <Card key={label} padding="8px 14px" className="ui-hstack" style={{ gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
          }}>
            <Icon size={12} style={{ color }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{count}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</div>
          </div>
        </Card>
      ))}
      {liveCount > 0 && (
        <Card padding="8px 14px" className="ui-hstack" style={{ gap: 6, borderColor: 'color-mix(in srgb, var(--green) 20%, transparent)' }}>
          <Zap size={12} style={{ color: 'var(--green)' }} />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 700 }}>{liveCount} LIVE</span>
        </Card>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Signals() {
  const [signals,   setSignals]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [usingPoll, setUsingPoll] = useState(false);

  const pollRef    = useRef(null);
  const mountedRef = useRef(true);

  // WS context — primary data source
  const { status: wsStatus, signals: wsSignals } = useWS();

  // ── WS → signals state ────────────────────────────────────────────────────
  useEffect(() => {
    if (!wsSignals?.length) return;
    setSignals(prev => mergeMany(prev, wsSignals));
    setUsingPoll(false);
  }, [wsSignals]);

  // ── Poll fallback when WS disconnected ────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const res = await simAPI.getSignals();
      const sigs = res.data?.signals;
      if (Array.isArray(sigs) && sigs.length > 0) {
        setSignals(prev => mergeMany(prev, sigs));
      }
    } catch (_err) {
      // Polling is a fallback path; keep the latest successful signals on transient failures.
    }
  }, []);

  useEffect(() => {
    const shouldPoll = wsStatus !== 'connected';
    setUsingPoll(shouldPoll);

    if (shouldPoll) {
      fetchAll();
      pollRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    } else {
      clearInterval(pollRef.current);
    }

    return () => clearInterval(pollRef.current);
  }, [wsStatus, fetchAll]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearInterval(pollRef.current); };
  }, []);

  // ── Manual fetch for quick-add chips ─────────────────────────────────────
  async function fetchSingle(symbol) {
    setLoading(true);
    try {
      const res  = await simAPI.getSignals([symbol]);
      const sigs = res.data?.signals;
      if (Array.isArray(sigs)) {
        setSignals(prev => mergeMany(prev, sigs));
      } else {
        // Fallback: signal controller single
        const { signalAPI } = await import('../services/api');
        const r = await signalAPI.get(symbol);
        const d = r.data;
        setSignals(prev => mergeSignal(prev, {
          symbol: d.symbol, signal: d.signal, confidence: d.confidence,
          currentPrice: d.currentPrice, rsi: d.rsiValue,
          sma20: d.maFast, sma50: d.maSlow,
          bbUpper: null, bbLower: null,
          source: d.simMode ? 'SIM' : 'LIVE',
          components: d.components || {},
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || `Failed: ${symbol}`, type: 'error' });
    } finally { setLoading(false); }
  }

  function removeSignal(symbol) {
    setSignals(prev => prev.filter(s => s.symbol !== symbol));
  }

  function handleTrade({ symbol, side, price, qty }) {
    setToast({
      message: `${side === 'BUY' ? '🟢' : '🔴'} ${symbol}: ${side} ×${qty} @ ₹${Number(price).toFixed(2)}`,
      type: side === 'BUY' ? 'success' : 'error',
    });
  }

  const chartData = signals.map(s => ({
    symbol:     s.symbol,
    confidence: Math.round((s.confidence || 0) * 100),
    signal:     s.signal,
  }));

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1400 }}>

          <PageHeader
            title="Signal Center"
            subtitle="RSI · SMA20/50 · Bollinger Bands · Real-time alerts"
            action={
              <>
                <ConnectionBadge wsStatus={wsStatus} usingPoll={usingPoll} />
                <Button variant="ghost" size="sm" onClick={fetchAll} disabled={loading}>
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
                </Button>
              </>
            }
          />

          {/* Quick-add chips */}
          <Card padding="14px 16px" style={{ marginBottom: 18 }}>
            <SectionLabel style={{ display: 'block', marginBottom: 10 }}>Quick Add</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_SYMBOLS.map(sym => {
                const existing = signals.find(s => s.symbol === sym);
                const sigColor = existing?.signal === 'BUY' ? 'var(--green)' : existing?.signal === 'SELL' ? 'var(--red)' : null;
                return (
                  <Chip key={sym} active={!!existing} onClick={() => fetchSingle(sym)}>
                    {sym}
                    {existing && sigColor && (
                      <span style={{ marginLeft: 5, color: sigColor, fontSize: 9 }}>
                        {existing.signal === 'BUY' ? '▲' : '▼'}
                      </span>
                    )}
                  </Chip>
                );
              })}
            </div>
          </Card>

          {/* Summary bar */}
          {signals.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SummaryBar signals={signals} />
            </div>
          )}

          {/* Confidence chart */}
          {signals.length > 0 && (
            <Card padding={16} style={{ marginBottom: 20 }}>
              <SectionLabel style={{ display: 'block', marginBottom: 12 }}>Confidence Comparison</SectionLabel>
              <div style={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <XAxis dataKey="symbol" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={[0, 100]} />
                    <Tooltip
                      formatter={v => [`${v}%`, 'Conf']}
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: 'var(--text-secondary)' }} />
                    <Bar dataKey="confidence" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {chartData.map((e, i) => (
                        <Cell key={i} fill={e.signal === 'BUY' ? 'var(--green)' : e.signal === 'SELL' ? 'var(--red)' : 'var(--amber)'} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Signal cards grid */}
          {signals.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No Signals Yet"
              description="Click a chip above or wait for WebSocket push"
            />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}>
              {signals.map(s => (
                <div key={s.symbol} style={{ position: 'relative' }}>
                  <button
                    onClick={() => removeSignal(s.symbol)}
                    aria-label={`Remove ${s.symbol} signal`}
                    style={{
                      position: 'absolute', top: 8, right: 8, zIndex: 10,
                      width: 20, height: 20, borderRadius: 4,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      color: 'var(--text-muted)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, lineHeight: 1,
                    }}
                  >✕</button>
                  <SignalCard
                    signal={s}
                    flash={false}
                    onTrade={handleTrade}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 50 }}>
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
