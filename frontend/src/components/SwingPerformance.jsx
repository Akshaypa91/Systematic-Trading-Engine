// src/components/SwingPerformance.jsx
// Monthly scorecard for the swing scanner, computed from real prices.
//
// Win rate is shown NEXT TO the number that gives it meaning: the breakeven win
// rate implied by the actual reward:risk. With a 0.7:1 payoff you need ~59% just
// to stand still, so a "60% win rate" headline on its own would be misleading —
// which is exactly why the two are never separated here.
import { useCallback, useEffect, useState } from 'react';
import { swingAPI } from '../services/api';
import { RefreshCw, Trophy, AlertTriangle } from 'lucide-react';

const MONTH_LABEL = (m) => {
  const [y, mo] = String(m || '').split('-');
  const d = new Date(Number(y), Number(mo) - 1, 1);
  // Never render "Invalid Date" at the user — if the bucket key is unparseable,
  // show the raw key so the problem is visible and debuggable instead of noise.
  return isNaN(d) ? (m || '—') : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

function Cell({ children, style }) {
  return <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5, ...style }}>{children}</td>;
}

export default function SwingPerformance() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setScoring(true) : setLoading(true);
    try {
      // 'all' on an explicit re-score: outcomes recorded under a different
      // holding window aren't comparable, so a manual re-score rebuilds the
      // whole table rather than topping up the undecided rows.
      const r = await swingAPI.performance(refresh ? 'all' : false);
      setData(r.data);
    } catch { /* leave last good */ }
    setLoading(false); setScoring(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (loading) return null;
  const o = data?.overall;
  if (!o || o.signals === 0) return null;

  // Below breakeven = the strategy loses money at this win rate, however good
  // the percentage looks in isolation.
  const beatsBreakeven = o.winRatePct != null && o.breakevenWinRatePct != null
    && o.winRatePct >= o.breakevenWinRatePct;
  const expColor = o.avgR == null ? 'var(--text-muted)' : o.avgR > 0 ? 'var(--green)' : 'var(--red)';

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <Trophy size={14} style={{ color: 'var(--cyan)' }} />
        <span className="section-label">Swing Performance</span>
        <button
          onClick={() => load(true)}
          disabled={scoring}
          className="btn btn-ghost"
          style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 10px' }}
        >
          <RefreshCw size={11} style={{ animation: scoring ? 'spin 1s linear infinite' : 'none' }} />
          {scoring ? 'Scoring…' : 'Re-score'}
        </button>
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Each signal is given {data.horizonBars} trading session{data.horizonBars === 1 ? '' : 's'} to reach its target,
        scored against real daily bars. A bar touching both target and stop counts as a stop — daily data can't prove which came first.
      </p>

      {/* Headline row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div className="mini-tile" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>WIN RATE</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: beatsBreakeven ? 'var(--green)' : 'var(--red)' }}>
            {o.winRatePct != null ? `${o.winRatePct}%` : '—'}
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
            {o.breakevenWinRatePct != null ? `breakeven ${o.breakevenWinRatePct}%` : `${o.decided} resolved`}
          </span>
        </div>
        <div className="mini-tile" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>EXPECTANCY</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: expColor }}>
            {o.avgR != null ? `${o.avgR > 0 ? '+' : ''}${o.avgR}R` : '—'}
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>per trade</span>
        </div>
        <div className="mini-tile" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>PAYOFF</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {o.avgRR != null ? `${o.avgRR}:1` : '—'}
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>reward : risk</span>
        </div>
        <div className="mini-tile" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>RESOLVED</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {o.decided}<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/{o.signals}</span>
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
            {o.unscored > 0 ? `${o.unscored} not scored` : `${o.open} still open`}
          </span>
        </div>
      </div>

      {/* Verdict — the sentence that stops the numbers being misread */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 11px', borderRadius: 7, marginBottom: 12,
        background: `color-mix(in srgb, ${o.reliable ? (o.avgR > 0 ? 'var(--green)' : 'var(--red)') : 'var(--amber)'} 7%, transparent)`,
        border: `1px solid color-mix(in srgb, ${o.reliable ? (o.avgR > 0 ? 'var(--green)' : 'var(--red)') : 'var(--amber)'} 20%, transparent)`,
      }}>
        <AlertTriangle size={11} style={{ color: o.reliable ? (o.avgR > 0 ? 'var(--green)' : 'var(--red)') : 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
        <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{o.verdict}</span>
      </div>

      {/* Monthly breakdown — cards on phones. A 7-column table there pushed
          Breakeven and Total R off-screen behind a scrollbar, i.e. hid exactly
          the two columns that make the win rate interpretable. */}
      <div className="nb-md-down-only" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.months.map(m => {
          const beats = m.winRatePct != null && m.breakevenWinRatePct != null && m.winRatePct >= m.breakevenWinRatePct;
          return (
            <div key={m.month} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{MONTH_LABEL(m.month)}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{m.signals} signals</span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: m.winRatePct == null ? 'var(--text-muted)' : beats ? 'var(--green)' : 'var(--red)' }}>
                  {m.winRatePct != null ? `${m.winRatePct}%` : '—'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--text-muted)' }}>W / L</span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ color: 'var(--green)' }}>{m.wins}</span>
                  <span style={{ color: 'var(--text-muted)' }}> / </span>
                  <span style={{ color: 'var(--red)' }}>{m.losses}</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>Breakeven</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {m.breakevenWinRatePct != null ? `${m.breakevenWinRatePct}%` : '—'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>Total R</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: m.totalR > 0 ? 'var(--green)' : m.totalR < 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                  {m.decided > 0 ? `${m.totalR > 0 ? '+' : ''}${m.totalR}R` : '—'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{m.unscored > 0 ? 'Not scored' : 'Open'}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{m.unscored > 0 ? m.unscored : (m.open || '—')}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="nb-md-up" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Month', 'Signals', 'W / L', 'Win %', 'Breakeven', 'Total R', 'Pending'].map((h, i) => (
                <th key={h} style={{
                  padding: '7px 10px', fontSize: 9.5, letterSpacing: '0.07em', textTransform: 'uppercase',
                  color: 'var(--text-muted)', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.months.map(m => {
              const beats = m.winRatePct != null && m.breakevenWinRatePct != null && m.winRatePct >= m.breakevenWinRatePct;
              return (
                <tr key={m.month} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)' }}>
                  <Cell style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{MONTH_LABEL(m.month)}</Cell>
                  <Cell style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{m.signals}</Cell>
                  <Cell style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--green)' }}>{m.wins}</span>
                    <span style={{ color: 'var(--text-muted)' }}> / </span>
                    <span style={{ color: 'var(--red)' }}>{m.losses}</span>
                  </Cell>
                  <Cell style={{ textAlign: 'right', fontWeight: 700, color: m.winRatePct == null ? 'var(--text-muted)' : beats ? 'var(--green)' : 'var(--red)' }}>
                    {m.winRatePct != null ? `${m.winRatePct}%` : '—'}
                  </Cell>
                  <Cell style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {m.breakevenWinRatePct != null ? `${m.breakevenWinRatePct}%` : '—'}
                  </Cell>
                  <Cell style={{ textAlign: 'right', fontWeight: 600, color: m.totalR > 0 ? 'var(--green)' : m.totalR < 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                    {m.decided > 0 ? `${m.totalR > 0 ? '+' : ''}${m.totalR}R` : '—'}
                  </Cell>
                  <Cell style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {m.unscored > 0 ? `${m.unscored} unscored` : (m.open || '—')}
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
