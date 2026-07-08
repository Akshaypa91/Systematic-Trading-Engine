// src/pages/Backtest.jsx — v2 analytics workspace on the ui/ design system.
// Config rail (left) · equity curve, KPI metrics, detailed stats, monthly
// P&L heatmap and sortable trade log (right). Data flow unchanged.
import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { useSearchParams } from 'react-router-dom';
import { backtestAPI } from '../services/api';
import EquityChart from '../components/EquityChart';
import TradesTable from '../components/TradesTable';
import MonthlyReturns from '../components/MonthlyReturns';
import Toast from '../components/Toast';
import {
  Button, Card, CardHeader, Field, Input, Select, Metric, Badge,
  EmptyState, PageHeader,
} from '../components/ui';
import { Play, TrendingUp, Activity, BarChart2, Shield, Clock, CalendarDays } from 'lucide-react';
import { inr, pct } from '../utils/format';

const STRATEGIES = ['AGGREGATED', 'RSI', 'MA_CROSSOVER', 'MEAN_REVERSION'];

function StatRow({ label, value, color }) {
  return (
    <div className="ui-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

export default function Backtest() {
  const [searchParams] = useSearchParams();
  const initSymbol = searchParams.get('symbol') || 'RELIANCE';
  const [form, setForm] = useState({
    symbol: initSymbol, strategy: 'AGGREGATED',
    startDate: '2022-01-01', endDate: '2024-01-01',
    initialCapital: 1000000, stopLossPct: 0.02, takeProfitPct: 0.04, riskPerTrade: 0.02,
  });
  const [result,  setResult]  = useState(null);
  const [trades,  setTrades]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [runs,    setRuns]    = useState([]);
  const [toast,   setToast]   = useState(null);

  useEffect(() => {
    backtestAPI.getRuns(undefined, 10).then(r => setRuns(r.data.data || [])).catch(() => {});
  }, []);

  async function run(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await backtestAPI.run(form);
      const { summary, trades: t, equityCurveSample } = res.data;
      setResult({ summary, equityCurve: equityCurveSample });
      setTrades(t || []);
      backtestAPI.getRuns(undefined, 10).then(r => setRuns(r.data.data || [])).catch(() => {});
      setToast({ message: `Backtest complete — ${t?.length} trades`, type: 'success' });
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Failed', type: 'error' });
    } finally { setLoading(false); }
  }

  async function loadRun(runId) {
    try {
      const r = await backtestAPI.getTrades(runId);
      setTrades(r.data.data || []);
      setToast({ message: `Loaded run #${runId} trades`, type: 'info' });
    } catch (_err) {
      setToast({ message: 'Could not load trades for this run', type: 'error' });
    }
  }

  const s = result?.summary;

  const FIELDS = [
    ['Symbol',          'symbol',         'text'],
    ['Strategy',        'strategy',       'select', STRATEGIES],
    ['Start Date',      'startDate',      'date'],
    ['End Date',        'endDate',        'date'],
    ['Initial Capital', 'initialCapital', 'number'],
    ['Stop Loss %',     'stopLossPct',    'number'],
    ['Take Profit %',   'takeProfitPct',  'number'],
    ['Risk/Trade %',    'riskPerTrade',   'number'],
  ];

  return (
    <AppShell>
      <main className="page-content" style={{ maxWidth: 1500 }}>
        <PageHeader
          title="Backtester"
          subtitle="Historical strategy simulation · NSE India"
        />

        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="bt-layout">
          {/* ── Left rail: config + history ── */}
          <div className="ui-vstack" style={{ gap: 16 }}>
            <Card>
              <CardHeader title="Configuration" sub="Simulation parameters" />
              <form onSubmit={run} className="ui-vstack" style={{ gap: 12 }}>
                {FIELDS.map(([label, key, type, opts]) => (
                  <Field key={key} label={label}>
                    {type === 'select' ? (
                      <Select value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}>
                        {opts.map(o => <option key={o}>{o}</option>)}
                      </Select>
                    ) : (
                      <Input
                        type={type}
                        step={type === 'number' ? '0.01' : undefined}
                        value={form[key]}
                        onChange={e => setForm(p => ({ ...p, [key]: type === 'number' ? +e.target.value : e.target.value.toUpperCase() }))}
                      />
                    )}
                  </Field>
                ))}
                <Button type="submit" variant="cyan" icon={Play} loading={loading} style={{ justifyContent: 'center', marginTop: 4 }}>
                  {loading ? 'Running…' : 'Run Backtest'}
                </Button>
              </form>
            </Card>

            {runs.length > 0 && (
              <Card>
                <CardHeader title="History" sub="Saved runs" action={<Clock size={13} style={{ color: 'var(--text-muted)' }} />} />
                <div className="ui-vstack" style={{ gap: 8 }}>
                  {runs.map((r, i) => (
                    <button
                      key={r.id || i}
                      onClick={() => loadRun(r.id)}
                      className="mini-tile"
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
                    >
                      <div className="ui-between">
                        <span className="sym">{r.symbol}</span>
                        <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: Number(r.total_return_pct) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {pct(r.total_return_pct, { decimals: 1 })}
                        </span>
                      </div>
                      <div className="ui-between">
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.strategy}</span>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {new Date(r.created_at).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* ── Right: results ── */}
          <div className="ui-vstack" style={{ gap: 16 }}>
            <Card>
              <CardHeader
                title="Equity Curve"
                sub={s ? `${form.symbol} · ${form.strategy} · ${inr(form.initialCapital)} initial` : 'Run a backtest to visualize'}
                action={s && <Badge>{form.symbol} · {form.strategy}</Badge>}
              />
              <EquityChart data={result?.equityCurve || []} initialCapital={form.initialCapital} height={250} />
            </Card>

            {s && (
              <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <Metric label="Total Return" icon={TrendingUp}
                  value={pct(s.totalReturnPct)}
                  sub={`Final ${inr(s.finalCapital)}`}
                  color={s.totalReturnPct >= 0 ? 'green' : 'red'} />
                <Metric label="Win Rate" icon={Activity}
                  value={`${s.winRatePct?.toFixed(1)}%`}
                  sub={`${s.winningTrades}W / ${s.losingTrades}L`}
                  color="cyan" />
                <Metric label="Sharpe" icon={BarChart2}
                  value={s.sharpeRatio?.toFixed(3)}
                  sub="Risk-adjusted return"
                  color={s.sharpeRatio >= 1 ? 'green' : 'amber'} />
                <Metric label="Max Drawdown" icon={Shield}
                  value={`${s.maxDrawdownPct?.toFixed(2)}%`}
                  sub={`Profit factor ${s.profitFactor?.toFixed(2)}`}
                  color="red" />
              </div>
            )}

            {s && (
              <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <Card>
                  <CardHeader title="Performance" />
                  <StatRow label="Initial Capital" value={inr(s.initialCapital)} />
                  <StatRow label="Final Capital"   value={inr(s.finalCapital)} color={s.totalReturnPct >= 0 ? 'var(--green)' : 'var(--red)'} />
                  <StatRow label="Ann. Return"     value={pct(s.annualisedReturnPct)} />
                  <StatRow label="Profit Factor"   value={s.profitFactor?.toFixed(2)} />
                  <StatRow label="Avg Win"         value={pct(s.avgWinPct)}  color="var(--green)" />
                  <StatRow label="Avg Loss"        value={pct(s.avgLossPct)} color="var(--red)" />
                </Card>
                <Card>
                  <CardHeader title="Trade Stats" />
                  <StatRow label="Total Trades"   value={s.totalTrades} />
                  <StatRow label="Winning Trades" value={s.winningTrades} color="var(--green)" />
                  <StatRow label="Losing Trades"  value={s.losingTrades}  color="var(--red)" />
                  <StatRow label="Win Rate"       value={`${s.winRatePct?.toFixed(1)}%`} />
                  <StatRow label="Period"         value={`${s.startDate} → ${s.endDate}`} />
                </Card>
                <Card>
                  <CardHeader title="Risk Metrics" />
                  <StatRow label="Sharpe Ratio" value={s.sharpeRatio?.toFixed(4)} />
                  <StatRow label="Max Drawdown" value={`${s.maxDrawdownPct?.toFixed(2)}%`} color="var(--red)" />
                  <StatRow label="Stop Loss"    value={`${(form.stopLossPct * 100).toFixed(1)}%`} />
                  <StatRow label="Take Profit"  value={`${(form.takeProfitPct * 100).toFixed(1)}%`} />
                  <StatRow label="Risk/Trade"   value={`${(form.riskPerTrade * 100).toFixed(1)}%`} />
                </Card>
              </div>
            )}

            {trades.length > 0 && (
              <Card className="fade-in">
                <CardHeader
                  title="Monthly P&L"
                  sub="Aggregated from the trade log by exit month"
                  action={<CalendarDays size={13} style={{ color: 'var(--text-muted)' }} />}
                />
                <MonthlyReturns trades={trades} initialCapital={s?.initialCapital ?? form.initialCapital} />
              </Card>
            )}

            {trades.length > 0 && (
              <Card className="fade-in">
                <CardHeader title="Trade Log" sub={`${trades.length} executed trades · click headers to sort`} />
                <TradesTable trades={trades} loading={loading} />
              </Card>
            )}

            {!result && !loading && (
              <EmptyState
                icon={BarChart2}
                title="No results yet"
                description='Configure the parameters and click "Run Backtest"'
              />
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
