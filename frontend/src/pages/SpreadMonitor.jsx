// src/pages/SpreadMonitor.jsx
// NSE ↔ BSE price-difference monitor. Shows the same security's price on both
// exchanges, the gap in ₹/bps, and — the part that matters — the round-trip cost
// needed to capture it. Read-only; places no orders.
import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { marketAPI } from '../services/api';
import { useTradingMode } from '../context/TradingModeContext';
import { ArrowLeftRight, RefreshCw, Info, ShieldOff, Loader2, Clock } from 'lucide-react';

const bps = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} bps`);
const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function SpreadMonitor() {
  const { brokerLinked } = useTradingMode();
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState(null);
  const [qty, setQty]       = useState(100);
  const [syncedAt, setSync] = useState(null);

  const load = useCallback(async () => {
    setLoad(true); setErr(null);
    try {
      const res = await marketAPI.spreads({ qty });
      setData(res.data);
      setSync(new Date());
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not load spreads');
    } finally { setLoad(false); }
  }, [qty]);

  useEffect(() => { load(); }, [load]);

  const rows = data?.results || [];

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1180 }}>
          {/* Title and controls wrap onto separate rows on narrow screens —
              side-by-side squeezed the heading into three lines on mobile. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <ArrowLeftRight size={18} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>NSE ↔ BSE Spread</h1>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {syncedAt && (
                <span className="font-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-muted)' }}>
                  <Clock size={10} /> {syncedAt.toLocaleTimeString('en-IN', { hour12: false })}
                </span>
              )}
              <label className="font-mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                qty
                <input type="number" min="1" value={qty} onChange={e => setQty(Math.max(1, +e.target.value || 1))}
                  style={{ width: 68, padding: '3px 6px', borderRadius: 6, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </label>
              <button onClick={load} className="ws-pill" style={{ cursor: 'pointer' }}>
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
            Same security, two exchanges · spread vs cost-to-capture
          </p>

          {/* The honest framing, stated once and up front. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 10, marginBottom: 16,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <Info size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              This is a <b>measurement tool, not an arbitrage engine</b>. Capturing a cross-exchange gap needs
              millisecond execution and inventory on both exchanges; this system's measured reaction is
              <b> seconds</b>. Expect the cost column to exceed the spread — that is the real lesson.
            </span>
          </div>

          {!brokerLinked && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10, marginBottom: 16,
              background: 'color-mix(in srgb, var(--amber) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 24%, transparent)' }}>
              <ShieldOff size={15} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Connect Upstox — live quotes from both exchanges are required.</span>
            </div>
          )}

          {err && (
            <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 12, color: 'var(--red)',
              background: 'color-mix(in srgb, var(--red) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 24%, transparent)' }}>{err}</div>
          )}

          {data?.summary && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              {[
                ['Pairs compared', data.summary.pairs],
                ['Capturable after costs', data.summary.capturableAfterCosts],
                ['Qty modelled', data.qty ?? qty],
              ].map(([label, val], i) => (
                // minWidth 110 lets all three tiles sit on one row on a phone
                // instead of 2 + 1 orphan.
                <div key={label} className="card" style={{ flex: 1, minWidth: 110, padding: 14 }}>
                  <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: i === 1 ? (val > 0 ? 'var(--green)' : 'var(--text-secondary)') : 'var(--text-primary)' }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {loading && !rows.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 40, justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={18} className="animate-spin" /> <span style={{ fontSize: 12 }}>Fetching both exchanges…</span>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '44px 24px', color: 'var(--text-muted)' }}>
              <ArrowLeftRight size={22} style={{ opacity: 0.3 }} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>No paired quotes</span>
              <span className="font-mono" style={{ fontSize: 10.5 }}>Needs a broker session and both NSE + BSE listings.</span>
            </div>
          ) : (
            <>
            {/* MOBILE: cards. A 780px-wide table clipped exactly the columns
                that matter (cost, net, verdict) behind a horizontal scroll. */}
            <div className="nb-md-down-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(r => (
                <div key={r.symbol} className="card" style={{ padding: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{r.symbol}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                      background: r.capturable ? 'color-mix(in srgb, var(--green) 13%, transparent)' : 'color-mix(in srgb, var(--red) 11%, transparent)',
                      color: r.capturable ? 'var(--green)' : 'var(--red)' }}>
                      {r.capturable ? 'CLEARS COSTS' : 'NOT VIABLE'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                    {[
                      ['NSE', inr(r.nse), r.cheaper === 'NSE' ? 'var(--green)' : 'var(--text-secondary)'],
                      ['BSE', inr(r.bse), r.cheaper === 'BSE' ? 'var(--green)' : 'var(--text-secondary)'],
                      ['Spread', `${inr(r.spreadAbs)} · ${bps(r.spreadBps)}`, 'var(--cyan)'],
                      ['Cost', bps(r.costBps), 'var(--amber)'],
                      ['Net', `${r.netBps > 0 ? '+' : ''}${bps(r.netBps)}`, r.netBps > 0 ? 'var(--green)' : 'var(--red)'],
                    ].map(([k, v, c]) => (
                      <div key={k}>
                        <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{k}</div>
                        <div style={{ color: c, fontWeight: k === 'Net' ? 700 : 500 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {data?.skipped?.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  No BSE quote for: {data.skipped.join(', ')}
                </div>
              )}
            </div>

            {/* DESKTOP: full table */}
            <div className="card nb-md-up" style={{ padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', minWidth: 780, borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                    {['Symbol', 'NSE', 'BSE', 'Spread', 'Spread bps', 'Cost bps', 'Net bps', 'Verdict'].map(h => (
                      <th key={h} style={{ padding: '9px 12px', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.symbol} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>{r.symbol}</td>
                      <td style={{ padding: '9px 12px', color: r.cheaper === 'NSE' ? 'var(--green)' : 'var(--text-secondary)' }}>{inr(r.nse)}</td>
                      <td style={{ padding: '9px 12px', color: r.cheaper === 'BSE' ? 'var(--green)' : 'var(--text-secondary)' }}>{inr(r.bse)}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{inr(r.spreadAbs)}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--cyan)' }}>{bps(r.spreadBps)}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--amber)' }}>{bps(r.costBps)}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 700, color: r.netBps > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {r.netBps > 0 ? '+' : ''}{bps(r.netBps)}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                          background: r.capturable ? 'color-mix(in srgb, var(--green) 13%, transparent)' : 'color-mix(in srgb, var(--red) 11%, transparent)',
                          color: r.capturable ? 'var(--green)' : 'var(--red)' }}>
                          {r.capturable ? 'CLEARS COSTS' : 'NOT VIABLE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data?.skipped?.length > 0 && (
                <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-dim)' }}>
                  No BSE quote for: {data.skipped.join(', ')}
                </div>
              )}
            </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
