import { useState, useEffect, useCallback } from 'react';
import { backtestAPI, tradeAPI, signalAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import MetricsCard from '../components/MetricsCard';
import EquityChart from '../components/EquityChart';
import TradesTable from '../components/TradesTable';
import SignalsPanel from '../components/SignalsPanel';
import Toast from '../components/Toast';
import {
  TrendingUp, Activity, Shield, BarChart2,
  Play, ChevronDown, RefreshCw, Clock, Zap
} from 'lucide-react';

const STRATEGIES    = ['AGGREGATED', 'RSI', 'MA_CROSSOVER', 'MEAN_REVERSION'];
const VALID_SYMBOLS = ['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','WIPRO','SBIN','AXISBANK'];

function SectionHeader({ title, sub, children }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [btForm, setBtForm] = useState({
    symbol: 'RELIANCE', strategy: 'AGGREGATED',
    startDate: '2022-01-01', endDate: '2024-01-01',
    initialCapital: 1000000, stopLossPct: 0.02, takeProfitPct: 0.04, riskPerTrade: 0.02,
  });
  const [btResult,   setBtResult]   = useState(null);
  const [trades,     setTrades]     = useState([]);
  const [btLoading,  setBtLoading]  = useState(false);
  const [portfolio,  setPortfolio]  = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [toast,      setToast]      = useState(null);
  const [showForm,   setShowForm]   = useState(true);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
  }, []);

  // Load portfolio on mount
  useEffect(() => {
    tradeAPI.getPortfolio()
      .then(r => setPortfolio(r.data.data))
      .catch(() => {});
    backtestAPI.getRuns(undefined, 5)
      .then(r => setRecentRuns(r.data.data || []))
      .catch(() => {});
  }, []);

  async function runBacktest(e) {
    e.preventDefault();
    setBtLoading(true);
    try {
      const res = await backtestAPI.run(btForm);
      const { summary, trades: t, equityCurveSample } = res.data;
      setBtResult({ summary, equityCurve: equityCurveSample });
      setTrades(t || []);
      setShowForm(false);
      showToast(`Backtest complete — ${t?.length || 0} trades`, 'success');
      // reload recent runs
      backtestAPI.getRuns(undefined, 5).then(r => setRecentRuns(r.data.data || [])).catch(() => {});
    } catch (err) {
      showToast(err.response?.data?.error || 'Backtest failed', 'error');
    } finally {
      setBtLoading(false);
    }
  }

  const summary = btResult?.summary;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <Sidebar />

      <main className="ml-48 pt-14 min-h-screen">
        <div className="p-6 max-w-screen-2xl">

          {/* Page header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Dashboard</h1>
              <p className="text-sm font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Systematic trading engine — NSE India
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm(v => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all"
                style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--accent-cyan)' }}>
                <Play size={13} /> Run Backtest <ChevronDown size={13} className={showForm ? 'rotate-180' : ''} style={{ transition: 'transform 0.2s' }} />
              </button>
            </div>
          </div>

          {/* Backtest form (collapsible) */}
          {showForm && (
            <div className="rounded-xl p-5 mb-6 fade-in"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <form onSubmit={runBacktest}>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  <FormField label="Symbol" className="col-span-2 md:col-span-1">
                    <input value={btForm.symbol} onChange={e => setBtForm(p => ({ ...p, symbol: e.target.value.toUpperCase() }))}
                      className="input-field" placeholder="RELIANCE" />
                  </FormField>
                  <FormField label="Strategy" className="col-span-2 md:col-span-1 lg:col-span-2">
                    <select value={btForm.strategy} onChange={e => setBtForm(p => ({ ...p, strategy: e.target.value }))} className="input-field">
                      {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Start Date">
                    <input type="date" value={btForm.startDate} onChange={e => setBtForm(p => ({ ...p, startDate: e.target.value }))} className="input-field" />
                  </FormField>
                  <FormField label="End Date">
                    <input type="date" value={btForm.endDate} onChange={e => setBtForm(p => ({ ...p, endDate: e.target.value }))} className="input-field" />
                  </FormField>
                  <FormField label="Capital (₹)">
                    <input type="number" value={btForm.initialCapital} onChange={e => setBtForm(p => ({ ...p, initialCapital: +e.target.value }))} className="input-field" />
                  </FormField>
                  <FormField label="Stop Loss %">
                    <input type="number" step="0.01" value={btForm.stopLossPct} onChange={e => setBtForm(p => ({ ...p, stopLossPct: +e.target.value }))} className="input-field" />
                  </FormField>
                  <FormField label="Take Profit %">
                    <input type="number" step="0.01" value={btForm.takeProfitPct} onChange={e => setBtForm(p => ({ ...p, takeProfitPct: +e.target.value }))} className="input-field" />
                  </FormField>
                </div>
                {/* Quick symbol chips */}
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="text-xs font-mono self-center" style={{ color: 'var(--text-muted)' }}>Available:</span>
                  {['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','WIPRO','SBIN','AXISBANK'].map(s => (
                    <button key={s} type="button"
                      onClick={() => setBtForm(p => ({ ...p, symbol: s }))}
                      className="px-2 py-0.5 rounded text-xs font-mono transition-all"
                      style={{
                        background: btForm.symbol === s ? 'rgba(0,212,255,0.15)' : 'var(--bg-elevated)',
                        border: btForm.symbol === s ? '1px solid rgba(0,212,255,0.4)' : '1px solid var(--border)',
                        color: btForm.symbol === s ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      }}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button type="submit" disabled={btLoading}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                    style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)', color: 'var(--accent-cyan)' }}>
                    {btLoading ? <><RefreshCw size={13} className="animate-spin" /> Running...</> : <><Play size={13} /> Run Backtest</>}
                  </button>
                  {btLoading && <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Fetching data & computing signals...</span>}
                </div>
              </form>
            </div>
          )}

          {/* Metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricsCard label="Total Return" icon={TrendingUp}
              value={summary ? `${summary.totalReturnPct?.toFixed(2)}%` : portfolio ? `₹${Number(portfolio.equity || 0).toLocaleString('en-IN', {maximumFractionDigits:0})}` : '—'}
              sub={summary ? `₹${Number(summary.finalCapital).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'Portfolio equity'}
              color={summary && summary.totalReturnPct >= 0 ? 'green' : 'red'}
              trend={summary?.totalReturnPct} />
            <MetricsCard label="Win Rate" icon={Activity}
              value={summary ? `${summary.winRatePct?.toFixed(1)}%` : '—'}
              sub={summary ? `${summary.winningTrades}W / ${summary.losingTrades}L of ${summary.totalTrades}` : 'Winning trades ratio'}
              color="cyan" />
            <MetricsCard label="Sharpe Ratio" icon={BarChart2}
              value={summary ? summary.sharpeRatio?.toFixed(3) : '—'}
              sub="Risk-adjusted return"
              color={summary && summary.sharpeRatio >= 1 ? 'green' : 'amber'} />
            <MetricsCard label="Max Drawdown" icon={Shield}
              value={summary ? `${summary.maxDrawdownPct?.toFixed(2)}%` : '—'}
              sub={summary ? `Profit factor: ${summary.profitFactor?.toFixed(2)}` : 'Peak-to-trough decline'}
              color="red" />
          </div>

          {/* Main grid: Chart + Signals */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Equity curve */}
            <div className="lg:col-span-2 rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <SectionHeader
                title="Equity Curve"
                sub={summary ? `${btForm.symbol} · ${btForm.strategy} · ₹${Number(btForm.initialCapital).toLocaleString('en-IN')} initial` : 'Run a backtest to visualize'}>
                {summary && (
                  <span className="text-xs font-mono px-2 py-1 rounded"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    {btResult.equityCurve.length} points
                  </span>
                )}
              </SectionHeader>
              <EquityChart data={btResult?.equityCurve || []} initialCapital={btForm.initialCapital} height={260} />
            </div>

            {/* Signals panel */}
            <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', minHeight: 380 }}>
              <SignalsPanel />
            </div>
          </div>

          {/* Recent backtest runs + Trades table */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Trades table */}
            <div className="xl:col-span-2 rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <SectionHeader title="Trade History" sub={trades.length ? `${trades.length} trades from last backtest` : 'Backtest results will appear here'} />
              <TradesTable trades={trades} loading={btLoading} />
            </div>

            {/* Recent backtest runs */}
            <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <SectionHeader title="Recent Runs" sub="Last 5 backtest runs">
                <Clock size={13} style={{ color: 'var(--text-muted)' }} />
              </SectionHeader>
              <div className="space-y-2">
                {recentRuns.length === 0 ? (
                  <p className="text-xs font-mono py-4 text-center" style={{ color: 'var(--text-muted)' }}>No saved runs</p>
                ) : recentRuns.map((run, i) => (
                  <div key={run.id || i} className="p-3 rounded-lg tr-hover cursor-pointer transition-colors"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                    onClick={async () => {
                      try {
                        const r = await backtestAPI.getTrades(run.id);
                        setTrades(r.data.data || []);
                        showToast(`Loaded run #${run.id}`, 'info');
                      } catch {}
                    }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{run.symbol}</span>
                      <span className="text-xs font-mono" style={{ color: Number(run.total_return_pct) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {Number(run.total_return_pct) >= 0 ? '+' : ''}{Number(run.total_return_pct).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{run.strategy}</span>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {new Date(run.created_at).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Signal Checker */}
          <div className="rounded-xl p-5 mt-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <SectionHeader title="Quick Signal Check" sub="Get instant signal for any seeded symbol" />
            <div className="flex flex-wrap gap-2">
              {VALID_SYMBOLS.map(sym => (
                <button key={sym}
                  onClick={async () => {
                    try {
                      const res = await signalAPI.get(sym);
                      const d = res.data;
                      const sigColor = d.signal === 'BUY' ? 'var(--accent-green)' : d.signal === 'SELL' ? 'var(--accent-red)' : 'var(--accent-amber)';
                      showToast(`${sym}: ${d.signal} · ${Math.round(d.confidence * 100)}% confidence`, d.signal === 'BUY' ? 'success' : d.signal === 'SELL' ? 'error' : 'info');
                    } catch(e) { showToast(`${sym}: ${e.response?.data?.error || 'Error'}`, 'error'); }
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-mono transition-all"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,212,255,0.4)'; e.currentTarget.style.color = 'var(--accent-cyan)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
                  <Zap size={10} style={{ display: 'inline', marginRight: 4 }} />{sym}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}

      {/* Inline styles for form inputs */}
      <style>{`
        .input-field {
          width: 100%;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.15s;
        }
        .input-field:focus { border-color: rgba(0,212,255,0.4); }
        .input-field option { background: var(--bg-elevated); }
      `}</style>
    </div>
  );
}

function FormField({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-xs font-mono uppercase tracking-wider block mb-1"
        style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}