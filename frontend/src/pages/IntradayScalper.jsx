// src/pages/IntradayScalper.jsx
// Research tool for the 1-minute VWAP scalper. Reports gross → costs → net
// separately, because on a high-turnover strategy the frictions ARE the result.
// It shows whatever the data says, including a large loss.
import { useState, useCallback } from 'react';
import AppShell from '../components/AppShell';
import SymbolInput from '../components/SymbolInput';
import { backtestAPI } from '../services/api';
import { Zap, Play, Loader2, Info, X, TrendingDown, TrendingUp } from 'lucide-react';

const inr  = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}₹${Math.abs(Number(v)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const pnlC = (v) => (v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-secondary)');

export default function IntradayScalper() {
  const [symbols, setSymbols] = useState(['RELIANCE', 'TCS', 'HDFCBANK']);
  const [draft,   setDraft]   = useState('');
  const [costBps, setCostBps] = useState(18);
  const [res,     setRes]     = useState(null);
  const [loading, setLoad]    = useState(false);
  const [err,     setErr]     = useState(null);

  const run = useCallback(async () => {
    setLoad(true); setErr(null);
    try {
      const r = await backtestAPI.intraday({ symbols, costBps: Number(costBps) || 18 });
      setRes(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Backtest failed');
    } finally { setLoad(false); }
  }, [symbols, costBps]);

  const addSymbol = (s) => {
    const up = String(s || '').toUpperCase().trim();
    if (up && !symbols.includes(up) && symbols.length < 10) setSymbols([...symbols, up]);
    setDraft('');
  };

  const t = res?.totals;

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Zap size={18} style={{ color: 'var(--amber)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Intraday Scalper</h1>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
            1-minute VWAP mean reversion · costs reported separately
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 10, marginBottom: 16,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <Info size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              The strategy only signals when the expected move clears costs by <b>2×</b>; setups that fail
              that test are skipped. Uses Upstox 1-minute history (~30 days). Measured system reaction is
              <b> seconds</b>, so this is not HFT — validate before trusting any result.
            </span>
          </div>

          {/* Config */}
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {symbols.map(s => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 99,
                  fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  {s}
                  <button onClick={() => setSymbols(symbols.filter(x => x !== s))} aria-label={`Remove ${s}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {symbols.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Add at least one symbol</span>}
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>Add symbol</div>
                <SymbolInput value={draft} onChange={(v) => { setDraft(v); if (v && v.length > 2) addSymbol(v); }} placeholder="Search…" />
              </div>
              <div style={{ minWidth: 140 }}>
                <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>Round-trip cost (bps)</div>
                <input type="number" min="0" step="1" value={costBps} onChange={e => setCostBps(e.target.value)} className="input"
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }} />
              </div>
              <button onClick={run} disabled={loading || !symbols.length} className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', opacity: (loading || !symbols.length) ? 0.6 : 1 }}>
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run backtest
              </button>
            </div>
          </div>

          {err && (
            <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 12, color: 'var(--red)',
              background: 'color-mix(in srgb, var(--red) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 24%, transparent)' }}>{err}</div>
          )}

          {t && (
            <>
              {/* Gross → costs → net, in that order, because that is the story. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                {[
                  ['Trades', t.trades, 'var(--text-primary)'],
                  ['Win rate', `${t.winRatePct}%`, t.winRatePct >= 40 ? 'var(--green)' : 'var(--red)'],
                  ['Gross P&L', inr(t.gross), pnlC(t.gross)],
                  ['Costs', inr(-Math.abs(t.cost)), 'var(--amber)'],
                  ['NET P&L', inr(t.net), pnlC(t.net)],
                ].map(([label, val, color], i) => (
                  <div key={label} className="card" style={{ flex: 1, minWidth: 130, padding: 14 }}>
                    <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>{label}</div>
                    <div style={{ fontSize: i === 4 ? 21 : 17, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 15px', borderRadius: 10, marginBottom: 16,
                background: `color-mix(in srgb, ${t.net > 0 ? 'var(--green)' : 'var(--red)'} 7%, transparent)`,
                border: `1px solid color-mix(in srgb, ${t.net > 0 ? 'var(--green)' : 'var(--red)'} 26%, transparent)` }}>
                {t.net > 0 ? <TrendingUp size={15} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
                           : <TrendingDown size={15} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {res.verdict}
                  {t.costDragPct != null && <> Costs were <b>{t.costDragPct}%</b> of gross.</>}
                  {t.net > 0 && <> After 20% STCG ≈ <b>{inr(t.netAfterTax)}</b>.</>}
                </div>
              </div>

              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                      {['Symbol', 'Trades', 'Win%', 'Gross', 'Costs', 'Net', 'Avg held', 'Buy & hold'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase',
                          color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {res.perSymbol.map(r => (
                      <tr key={r.symbol} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>{r.symbol}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{r.trades}</td>
                        <td style={{ padding: '9px 12px', color: r.winRatePct >= 40 ? 'var(--green)' : 'var(--red)' }}>{r.winRatePct}%</td>
                        <td style={{ padding: '9px 12px', color: pnlC(r.gross) }}>{inr(r.gross)}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--amber)' }}>{inr(-Math.abs(r.cost))}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 700, color: pnlC(r.net) }}>{inr(r.net)}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-muted)' }}>{r.avgHeldBars} bars</td>
                        <td style={{ padding: '9px 12px', color: pnlC(r.buyHoldNet) }}>{inr(r.buyHoldNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {res.skipped?.length > 0 && (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-dim)' }}>
                    Insufficient 1-min history: {res.skipped.join(', ')}
                  </div>
                )}
              </div>
            </>
          )}

          {!t && !loading && !err && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '44px 24px', color: 'var(--text-muted)' }}>
              <Zap size={22} style={{ opacity: 0.3 }} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>No run yet</span>
              <span className="font-mono" style={{ fontSize: 10.5 }}>Pick symbols and run — needs a broker session for 1-minute data.</span>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
