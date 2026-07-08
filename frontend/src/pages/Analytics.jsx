// src/pages/Analytics.jsx
// Portfolio analytics: daily returns, drawdown, sector exposure, risk metrics
import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { SkeletonMetric, SkeletonChart } from '../components/Skeleton';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Activity, ShieldAlert,
  BarChart2, PieChart, RefreshCw,
} from 'lucide-react';
import { simAPI } from '../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => `${n >= 0 ? '+' : ''}${fmt(n)}%`;

function MetricCard({ label, value, sub, color = 'var(--cyan)', icon: Icon, loading }) {
  if (loading) return <SkeletonMetric />;
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span className="section-label">{label}</span>
        {Icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={14} style={{ color }} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, prefix = '', suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 13, fontWeight: 600, color: p.value >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
          {prefix}{fmt(p.value)}{suffix}
        </p>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [equity,   setEquity]   = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [portRes, eqRes] = await Promise.allSettled([
        simAPI.getPortfolio(),
        simAPI.getEquity(),
      ]);

      if (portRes.status === 'fulfilled') {
        const d = portRes.value.data?.data ?? portRes.value.data ?? {};
        setPortfolio(d);
      }

      if (eqRes.status === 'fulfilled') {
        const raw = eqRes.value.data?.data ?? [];
        setEquity(raw.map((p, i, arr) => ({
          t:       new Date(p.t).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
          equity:  parseFloat((p.equity || 0).toFixed(2)),
          return:  i > 0 ? parseFloat(((p.equity - arr[i-1].equity) / arr[i-1].equity * 100).toFixed(3)) : 0,
        })));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const initialCapital = portfolio?.initialCapital || 1_000_000;
  const currentEquity  = portfolio?.equity         || portfolio?.capital || initialCapital;
  const totalReturn    = ((currentEquity - initialCapital) / initialCapital * 100);
  const openPnL        = portfolio?.openPnl        || 0;
  const totalPnL       = portfolio?.totalPnl       || 0;

  // Max drawdown from equity curve
  let maxDD = 0;
  if (equity.length > 1) {
    let peak = equity[0].equity;
    for (const p of equity) {
      if (p.equity > peak) peak = p.equity;
      const dd = (peak - p.equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }
  }

  // Daily return series for bar chart (last 30 points)
  const dailyReturns = equity.slice(-30).map(p => ({ ...p }));
  const winDays = dailyReturns.filter(p => p.return > 0).length;
  const lossDays = dailyReturns.filter(p => p.return < 0).length;

  // Open positions for allocation
  const positions = portfolio?.openPositions || {};
  const posEntries = Object.entries(positions);
  const totalInvested = posEntries.reduce((s, [, p]) => s + (p.qty * (p.currentPrice || p.entryPrice)), 0);

  return (
    <AppShell>
      <div className="page-content">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Portfolio Analytics
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Performance breakdown · Paper trading
            </p>
          </div>
          <button onClick={load} className="btn btn-ghost" style={{ gap: 6 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)', fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* Metric tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          <MetricCard
            label="Total Return" loading={loading}
            value={fmtPct(totalReturn)}
            sub={`₹${fmt(currentEquity - initialCapital, 0)} P&L`}
            color={totalReturn >= 0 ? 'var(--green)' : 'var(--red)'}
            icon={totalReturn >= 0 ? TrendingUp : TrendingDown}
          />
          <MetricCard
            label="Current Equity" loading={loading}
            value={`₹${fmt(currentEquity, 0)}`}
            sub={`Started ₹${fmt(initialCapital, 0)}`}
            color="var(--cyan)" icon={Activity}
          />
          <MetricCard
            label="Open PnL" loading={loading}
            value={`₹${fmt(openPnL, 0)}`}
            sub={`${posEntries.length} positions`}
            color={openPnL >= 0 ? 'var(--green)' : 'var(--red)'}
            icon={BarChart2}
          />
          <MetricCard
            label="Max Drawdown" loading={loading}
            value={`-${fmt(maxDD)}%`}
            sub="Peak to trough"
            color="var(--amber)" icon={ShieldAlert}
          />
          <MetricCard
            label="Win Days" loading={loading}
            value={`${winDays}/${winDays + lossDays}`}
            sub={`${winDays + lossDays > 0 ? fmt(winDays / (winDays + lossDays) * 100, 0) : 0}% win rate`}
            color="var(--green)" icon={TrendingUp}
          />
          <MetricCard
            label="Realized PnL" loading={loading}
            value={`₹${fmt(totalPnL, 0)}`}
            sub="Closed trades"
            color={totalPnL >= 0 ? 'var(--green)' : 'var(--red)'}
            icon={PieChart}
          />
        </div>

        {/* Equity curve */}
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Equity Curve</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Portfolio value over time</div>
            </div>
          </div>
          {loading ? <SkeletonChart height={220} /> : equity.length < 2 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Not enough data yet — start trading to see your equity curve</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={equity} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--cyan)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip prefix="₹" />} />
                <ReferenceLine y={initialCapital} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="equity" stroke="var(--cyan)" strokeWidth={2}
                  fill="url(#eqGrad)" dot={false} activeDot={{ r: 4, fill: 'var(--cyan)' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Daily returns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Daily Returns</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 16 }}>Last 30 data points</div>
            {loading ? <SkeletonChart height={160} /> : dailyReturns.length < 2 ? (
              <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No return data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={dailyReturns} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `${v.toFixed(1)}%`} />
                  <Tooltip content={<CustomTooltip suffix="%" />} />
                  <ReferenceLine y={0} stroke="var(--border-bright)" />
                  <Bar dataKey="return" radius={[2, 2, 0, 0]}>
                    {dailyReturns.map((entry, i) => (
                      <Cell key={i} fill={entry.return >= 0 ? 'var(--green)' : 'var(--red)'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Allocation */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Position Allocation</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 16 }}>
              {totalInvested > 0 ? `₹${fmt(totalInvested, 0)} invested` : 'No open positions'}
            </div>
            {posEntries.length === 0 ? (
              <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No open positions</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {posEntries.slice(0, 6).map(([sym, pos]) => {
                  const val = pos.qty * (pos.currentPrice || pos.entryPrice);
                  const pct = totalInvested > 0 ? (val / totalInvested * 100) : 0;
                  const pnl = (pos.currentPrice - pos.entryPrice) * pos.qty;
                  return (
                    <div key={sym}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{sym}</span>
                        <span style={{ fontSize: 11, color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                          {pnl >= 0 ? '+' : ''}₹{fmt(pnl, 0)}
                        </span>
                      </div>
                      <div style={{ height: 4, borderRadius: 99, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 99,
                          width: `${Math.min(pct, 100)}%`,
                          background: pnl >= 0 ? 'var(--green)' : 'var(--red)',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{pos.qty} shares</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmt(pct, 1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
