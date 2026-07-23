// src/pages/ExecutionQuality.jsx
// Surfaces the backend execution-quality analytics (slippage vs expected price)
// and the measured slippage estimate that can feed the backtester. Read-only.
import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { liveAPI } from '../services/api';
import { useTradingMode } from '../context/TradingModeContext';
import { Gauge, RefreshCw, TrendingDown, ShieldOff, Info, Loader2 } from 'lucide-react';

const bps   = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)} bps`;
const money = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
// Cost convention: positive bps = adverse (bad) → red; negative = price improvement → green.
const costColor = (v) => v > 0 ? 'var(--red)' : v < 0 ? 'var(--green)' : 'var(--text-secondary)';

function Metric({ label, value, color, hint }) {
  return (
    <div className="card" style={{ padding: 14, flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{hint}</div>}
    </div>
  );
}

export default function ExecutionQuality() {
  const { brokerLinked } = useTradingMode();
  const [data, setData]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [err, setErr]     = useState(null);

  const load = useCallback(async () => {
    setLoad(true); setErr(null);
    try {
      const res = await liveAPI.executionQuality();
      setData(res.data?.data || null);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load execution quality');
    } finally { setLoad(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = data || {};
  const hasData = (s.count || 0) > 0;
  const suggestedBps = s.suggestedBacktestSlippagePct != null ? (s.suggestedBacktestSlippagePct * 10000) : null;
  const symbols = Object.entries(s.bySymbol || {}).sort((a, b) => b[1].avgBps - a[1].avgBps);

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Gauge size={18} style={{ color: 'var(--cyan)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Execution Quality</h1>
            <button onClick={load} className="ws-pill" style={{ marginLeft: 'auto', cursor: 'pointer' }} aria-label="Refresh">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
            Slippage vs expected price on filled live orders · lower is better
          </p>

          {!brokerLinked && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--amber) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 24%, transparent)' }}>
              <ShieldOff size={15} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Broker not connected — slippage is measured from real Upstox fills.</span>
            </div>
          )}

          {err && (
            <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 12, color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 24%, transparent)' }}>{err}</div>
          )}

          {loading && !data ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 40, justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={18} className="animate-spin" /> <span style={{ fontSize: 12 }}>Loading execution quality…</span>
            </div>
          ) : !hasData ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 24px', color: 'var(--text-muted)' }}>
              <TrendingDown size={26} style={{ opacity: 0.3 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>No filled orders yet</span>
              <span className="font-mono" style={{ fontSize: 11, textAlign: 'center', maxWidth: 380, lineHeight: 1.6 }}>
                Once live orders fill, this page shows how far each fill drifted from the price you expected — your real trading cost.
              </span>
            </div>
          ) : (
            <>
              {/* Summary metrics */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <Metric label="Avg Slippage" value={bps(s.avgSlippageBps)} color={costColor(s.avgSlippageBps)} hint={`${s.count} fill${s.count === 1 ? '' : 's'}`} />
                <Metric label="Median" value={bps(s.medianSlippageBps)} color={costColor(s.medianSlippageBps)} />
                <Metric label="Worst" value={bps(s.worstSlippageBps)} color={costColor(s.worstSlippageBps)} />
                <Metric label="Favorable Rate" value={`${((s.favorableRate || 0) * 100).toFixed(0)}%`} color={s.favorableRate >= 0.5 ? 'var(--green)' : 'var(--amber)'} hint="price improvement" />
                <Metric label="Total Slippage Cost" value={money(s.totalSlippageCost)} color={costColor(s.totalSlippageCost)} />
              </div>

              {/* Backtest feedback callout */}
              {suggestedBps != null && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--cyan) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--cyan) 22%, transparent)' }}>
                  <Info size={14} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Based on your fills, use <b style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>{suggestedBps.toFixed(1)} bps</b>{' '}
                    (<span style={{ fontFamily: 'var(--font-mono)' }}>{(s.suggestedBacktestSlippagePct).toFixed(5)}</span>) as the slippage assumption in backtests so simulations reflect your real execution, not a guess.
                  </span>
                </div>
              )}

              {/* Per-symbol breakdown */}
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>By Symbol</div>
                <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                      {['Symbol', 'Fills', 'Avg Slippage'].map(h => (
                        <th key={h} style={{ padding: '9px 16px', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.map(([sym, v]) => (
                      <tr key={sym} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '9px 16px', fontWeight: 700, color: 'var(--text-primary)' }}>{sym}</td>
                        <td style={{ padding: '9px 16px', color: 'var(--text-secondary)' }}>{v.count}</td>
                        <td style={{ padding: '9px 16px', color: costColor(v.avgBps), fontWeight: 600 }}>{bps(v.avgBps)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
