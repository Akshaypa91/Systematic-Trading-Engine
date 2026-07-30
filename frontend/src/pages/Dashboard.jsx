import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { backtestAPI, tradeAPI, signalAPI } from '../services/api';
import { useWS } from '../context/WSContext';
import EquityChart from '../components/EquityChart';
import TradesTable from '../components/TradesTable';
import SignalsPanel from '../components/SignalsPanel';
import PortfolioHero from '../components/PortfolioHero';
import OpenPositions from '../components/OpenPositions';
import MarketWatch from '../components/MarketWatch';
import AllocationCard from '../components/AllocationCard';
import BrokerConnectBanner from '../components/BrokerConnectBanner';
import IndicesStrip from '../components/IndicesStrip';
import Toast from '../components/Toast';
import {
  Button, Card, CardHeader, Field, Input, Select, Metric, Chip,
  EmptyState, PageHeader, Badge,
} from '../components/ui';
import {
  TrendingUp, Activity, Shield, BarChart2,
  Play, ChevronDown, Clock, Zap, Layers, Radio, LineChart, PieChart,
} from 'lucide-react';
import { pct } from '../utils/format';

const STRATEGIES    = ['AGGREGATED', 'RSI', 'MA_CROSSOVER', 'MEAN_REVERSION'];
const VALID_SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'WIPRO', 'SBIN', 'AXISBANK'];
const WATCHLIST     = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN'];

export default function Dashboard() {
  const { portfolio: livePortfolio } = useWS();

  const [btForm, setBtForm] = useState({
    symbol: 'RELIANCE', strategy: 'AGGREGATED',
    startDate: '2022-01-01', endDate: '2024-01-01',
    initialCapital: 1000000, stopLossPct: 0.02, takeProfitPct: 0.04, riskPerTrade: 0.02,
  });
  const [btResult,   setBtResult]   = useState(null);
  const [btLabel,    setBtLabel]    = useState(null);
  const [trades,     setTrades]     = useState([]);
  const [btLoading,  setBtLoading]  = useState(false);
  const [portfolio,  setPortfolio]  = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [toast,      setToast]      = useState(null);
  const [showForm,   setShowForm]   = useState(false);

  const showToast = useCallback((msg, type = 'info') => setToast({ msg, type }), []);

  // Hydrate the dashboard from a SAVED run: the runs table stores the full
  // summary, and an equity curve is reconstructed from the trades' cumulative
  // P&L (trade-resolution, which is what those trades actually contain).
  const applyRun = useCallback(async (run, { toast: say = false } = {}) => {
    try {
      const summary = {
        totalReturnPct: +run.total_return_pct,
        finalCapital:   +run.final_capital,
        winRatePct:     +run.win_rate_pct,
        winningTrades:  run.winning_trades,
        losingTrades:   run.losing_trades,
        totalTrades:    run.total_trades,
        sharpeRatio:    +run.sharpe_ratio,
        maxDrawdownPct: +run.max_drawdown_pct,
        profitFactor:   +run.profit_factor,
      };
      let curve = [];
      let t = [];
      try {
        const r = await backtestAPI.getTrades(run.id);
        t = r.data.data || [];
        const initial = +run.initial_capital || 1000000;
        let eq = initial;
        curve = [initial, ...[...t]
          .sort((a, b) => String(a.exit_date || a.entry_date).localeCompare(String(b.exit_date || b.entry_date)))
          .map(tr => (eq += +tr.pnl || 0))];
      } catch (_) { /* summary alone is still worth showing */ }
      setBtResult({ summary, equityCurve: curve.length > 1 ? curve : [] });
      setTrades(t);
      setBtLabel(`${run.symbol} · ${run.strategy} · saved ${new Date(run.created_at).toLocaleDateString('en-IN')}`);
      if (say) showToast(`Loaded run #${run.id}`, 'info');
    } catch (_) {
      if (say) showToast('Could not load this run', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    tradeAPI.getPortfolio().then(r => setPortfolio(r.data.data)).catch(() => {});
    backtestAPI.getRuns(undefined, 5).then(r => {
      const runs = r.data.data || [];
      setRecentRuns(runs);
      // A returning user's dashboard should open with their last result on
      // screen, not two empty boxes asking them to do work first.
      if (runs.length > 0) applyRun(runs[0]);
    }).catch(() => {});
  }, [applyRun]);

  // Use live portfolio from WS if available
  const displayPort = livePortfolio || portfolio;

  async function runBacktest(e) {
    e.preventDefault();
    setBtLoading(true);
    try {
      const res = await backtestAPI.run(btForm);
      const { summary, trades: t, equityCurveSample } = res.data;
      setBtResult({ summary, equityCurve: equityCurveSample });
      setBtLabel(`${btForm.symbol} · ${btForm.strategy} · ₹${Number(btForm.initialCapital).toLocaleString('en-IN')} initial`);
      setTrades(t || []);
      setShowForm(false);
      showToast(`Backtest complete — ${t?.length || 0} trades`, 'success');
      backtestAPI.getRuns(undefined, 5).then(r => setRecentRuns(r.data.data || [])).catch(() => {});
    } catch (err) {
      showToast(err.response?.data?.error || 'Backtest failed', 'error');
    } finally {
      setBtLoading(false);
    }
  }

  const s = btResult?.summary;

  return (
    <AppShell>
      <main className="page-content">
        <PageHeader
          title="Dashboard"
          subtitle="Systematic trading engine · NSE India"
          action={
            <Button variant="primary" icon={Play} onClick={() => setShowForm(v => !v)}>
              Run Backtest
              <ChevronDown
                size={12}
                style={{ transform: showForm ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
              />
            </Button>
          }
        />

        {/* Broker connect prompt (only when Upstox isn't linked) */}
        <BrokerConnectBanner />

        {/* Market context first — NIFTY/SENSEX/BANKNIFTY, like any broker app.
            Renders nothing without real index quotes. */}
        <IndicesStrip />

        {/* Backtest form (collapsible) */}
        {showForm && (
          <Card className="fade-in dash-section">
            <CardHeader title="Backtest Configuration" sub="Historical strategy simulation" />
            <form onSubmit={runBacktest}>
              {/* auto-fit so the 8 fields wrap to 2-up on phones instead of
                  crushing into a fixed 8-column row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <Field label="Symbol" style={{ gridColumn: 'span 2' }}>
                  <Input
                    value={btForm.symbol}
                    onChange={e => setBtForm(p => ({ ...p, symbol: e.target.value.toUpperCase() }))}
                    placeholder="RELIANCE"
                  />
                </Field>
                <Field label="Strategy" style={{ gridColumn: 'span 2' }}>
                  <Select
                    value={btForm.strategy}
                    onChange={e => setBtForm(p => ({ ...p, strategy: e.target.value }))}
                  >
                    {STRATEGIES.map(st => <option key={st} value={st}>{st}</option>)}
                  </Select>
                </Field>
                <Field label="Start Date">
                  <Input type="date" value={btForm.startDate}
                    onChange={e => setBtForm(p => ({ ...p, startDate: e.target.value }))} />
                </Field>
                <Field label="End Date">
                  <Input type="date" value={btForm.endDate}
                    onChange={e => setBtForm(p => ({ ...p, endDate: e.target.value }))} />
                </Field>
                <Field label="Capital (₹)">
                  <Input type="number" value={btForm.initialCapital}
                    onChange={e => setBtForm(p => ({ ...p, initialCapital: +e.target.value }))} />
                </Field>
                <Field label="Stop Loss %">
                  <Input type="number" step="0.01" value={btForm.stopLossPct}
                    onChange={e => setBtForm(p => ({ ...p, stopLossPct: +e.target.value }))} />
                </Field>
                <Field label="Take Profit %">
                  <Input type="number" step="0.01" value={btForm.takeProfitPct}
                    onChange={e => setBtForm(p => ({ ...p, takeProfitPct: +e.target.value }))} />
                </Field>
              </div>

              {/* Quick symbol chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <span className="section-label" style={{ alignSelf: 'center' }}>Quick select:</span>
                {VALID_SYMBOLS.map(sym => (
                  <Chip key={sym} active={btForm.symbol === sym} onClick={() => setBtForm(p => ({ ...p, symbol: sym }))}>
                    {sym}
                  </Chip>
                ))}
              </div>

              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Button type="submit" variant="primary" icon={Play} loading={btLoading}>
                  {btLoading ? 'Running…' : 'Run Backtest'}
                </Button>
                {btLoading && (
                  <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Fetching data & computing signals…
                  </span>
                )}
              </div>
            </form>
          </Card>
        )}

        {/* Portfolio summary strip */}
        <PortfolioHero portfolio={displayPort} spark={btResult?.equityCurve || []} />

        {/* Backtest KPI row — rendered only once a backtest has run. Four big
            tiles of em-dashes front-and-centre made the whole page look
            unfinished; Groww/Tickertape never show placeholder metrics. */}
        {s && (
          <div className="dash-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Metric label="Total Return" icon={TrendingUp}
              value={pct(s.totalReturnPct)}
              sub={`Final ₹${Number(s.finalCapital).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
              color={s.totalReturnPct >= 0 ? 'green' : 'red'}
              trend={s.totalReturnPct} />
            <Metric label="Win Rate" icon={Activity}
              value={`${s.winRatePct?.toFixed(1)}%`}
              sub={`${s.winningTrades}W / ${s.losingTrades}L of ${s.totalTrades}`}
              color="cyan" />
            <Metric label="Sharpe Ratio" icon={BarChart2}
              value={s.sharpeRatio?.toFixed(3)}
              sub="Risk-adjusted return"
              color={s.sharpeRatio >= 1 ? 'green' : 'amber'} />
            <Metric label="Max Drawdown" icon={Shield}
              value={`${s.maxDrawdownPct?.toFixed(2)}%`}
              sub={`Profit factor: ${s.profitFactor?.toFixed(2)}`}
              color="red" />
          </div>
        )}

        {/* Equity curve + Live signals */}
        <div className="dash-grid-2 dash-section">
          <Card className="fade-up stagger-1">
            <CardHeader
              title="Equity Curve"
              sub={s ? (btLabel || 'Latest backtest') : 'Your first backtest will appear here'}
              action={s && btResult?.equityCurve?.length > 0 && (
                <Badge>{btResult.equityCurve.length} pts</Badge>
              )}
            />
            {btResult?.equityCurve?.length > 0 ? (
              <EquityChart data={btResult.equityCurve} initialCapital={btResult.equityCurve[0] ?? btForm.initialCapital} height={272} />
            ) : (
              /* Compact CTA, not a 270px void — only genuinely first-time
                 users ever see this (returning users get their last run). */
              <div style={{ height: 272, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <LineChart size={26} style={{ color: 'var(--text-dim)' }} />
                <p className="font-mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Backtest a strategy to see its equity curve here
                </p>
                <Button variant="primary" icon={Play} onClick={() => setShowForm(true)}>
                  Run your first backtest
                </Button>
              </div>
            )}
          </Card>

          <Card className="fade-up stagger-2" style={{ minHeight: 400 }}>
            <SignalsPanel />
          </Card>
        </div>

        {/* Open positions + Market watch + Allocation */}
        <div className="dash-grid-2 dash-section">
          <Card className="fade-up stagger-1">
            <CardHeader
              title="Open Positions"
              sub="Live portfolio holdings"
              action={<Layers size={13} style={{ color: 'var(--text-muted)' }} />}
            />
            <OpenPositions openPositions={displayPort?.openPositions} />
          </Card>

          <div className="ui-vstack" style={{ gap: 16 }}>
            <Card className="fade-up stagger-2">
              <CardHeader
                title="Market Watch"
                sub="Live when connected · last close otherwise"
                action={<span className="ui-hstack" style={{ gap: 6 }}><span className="live-dot" /><Radio size={13} style={{ color: 'var(--text-muted)' }} /></span>}
              />
              <MarketWatch symbols={WATCHLIST} />
            </Card>

            <Card className="fade-up stagger-3">
              <CardHeader
                title="Allocation"
                sub="Cost basis by holding"
                action={<PieChart size={13} style={{ color: 'var(--text-muted)' }} />}
              />
              <AllocationCard openPositions={displayPort?.openPositions} />
            </Card>
          </div>
        </div>

        {/* Trade history + Recent runs */}
        <div className="dash-grid-2 dash-section">
          <Card className="fade-up stagger-3">
            <CardHeader
              title="Trade History"
              sub={trades.length ? `${trades.length} executed trades` : 'From latest backtest'}
              action={<LineChart size={13} style={{ color: 'var(--text-muted)' }} />}
            />
            <TradesTable trades={trades} loading={btLoading} />
          </Card>

          <Card className="fade-up stagger-4">
            <CardHeader
              title="Recent Runs"
              sub="Saved backtests"
              action={<Clock size={13} style={{ color: 'var(--text-muted)' }} />}
            />
            {recentRuns.length === 0 ? (
              <EmptyState icon={Clock} description="No saved runs" style={{ padding: '32px 0', border: 'none', background: 'transparent' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentRuns.map((run, i) => {
                  // Loads the WHOLE run (KPIs + curve + trades), not just the
                  // trade list — clicking a run should show that run.
                  const loadRun = () => applyRun(run, { toast: true });
                  return (
                  <div key={run.id || i} className="mini-tile" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, cursor: 'pointer' }}
                    role="button" tabIndex={0}
                    aria-label={`Load backtest run ${run.symbol} ${run.strategy}, return ${pct(run.total_return_pct)}`}
                    onClick={loadRun}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadRun(); } }}>
                    <div className="ui-between">
                      <span className="sym">{run.symbol}</span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: Number(run.total_return_pct) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {pct(run.total_return_pct)}
                      </span>
                    </div>
                    <div className="ui-between">
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{run.strategy}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {new Date(run.created_at).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Quick signal check */}
        <Card className="fade-up">
          <CardHeader title="Quick Signal Check" sub="Fetch an on-demand signal" style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {VALID_SYMBOLS.map(sym => (
              <Button key={sym} variant="ghost" icon={Zap}
                onClick={async () => {
                  try {
                    const res = await signalAPI.get(sym);
                    const d = res.data;
                    const type = d.signal === 'BUY' ? 'success' : d.signal === 'SELL' ? 'error' : 'info';
                    showToast(`${sym}: ${d.signal} · ${Math.round(d.confidence * 100)}% confidence`, type);
                  } catch (e) {
                    showToast(`${sym}: ${e.response?.data?.error || 'Error'}`, 'error');
                  }
                }}>
                {sym}
              </Button>
            ))}
          </div>
        </Card>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
