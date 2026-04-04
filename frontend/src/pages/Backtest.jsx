import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { backtestAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import EquityChart from '../components/EquityChart';
import TradesTable from '../components/TradesTable';
import Toast from '../components/Toast';
import { Play, RefreshCw, TrendingUp, Activity, BarChart2, Shield, Target, Percent, DollarSign, Clock } from 'lucide-react';

const STRATEGIES = ['AGGREGATED','RSI','MA_CROSSOVER','MEAN_REVERSION'];

function StatRow({ label, value, color }) {
  return (
    <div className="flex items-center justify-between py-2"
      style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-mono font-semibold" style={{ color: color || 'var(--text-primary)' }}>{value}</span>
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
    } catch {}
  }

  const s = result?.summary;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <Sidebar />
      <main className="ml-48 pt-14 min-h-screen">
        <div className="p-6 max-w-screen-xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Backtester</h1>
            <p className="text-sm font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Historical strategy simulation · NSE India
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            {/* Left: form + history */}
            <div className="xl:col-span-1 space-y-4">
              {/* Config form */}
              <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <h3 className="text-xs font-mono uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>Configuration</h3>
                <form onSubmit={run} className="space-y-3">
                  {[
                    ['Symbol', 'symbol', 'text', null],
                    ['Strategy', 'strategy', 'select', STRATEGIES],
                    ['Start Date', 'startDate', 'date', null],
                    ['End Date',   'endDate',   'date', null],
                    ['Initial Capital', 'initialCapital', 'number', null],
                    ['Stop Loss %',    'stopLossPct',    'number', null],
                    ['Take Profit %',  'takeProfitPct',  'number', null],
                    ['Risk/Trade %',   'riskPerTrade',   'number', null],
                  ].map(([label, key, type, opts]) => (
                    <div key={key}>
                      <label className="text-xs font-mono block mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
                      {type === 'select' ? (
                        <select value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                          {opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={type} step={type === 'number' ? '0.01' : undefined}
                          value={form[key]}
                          onChange={e => setForm(p => ({ ...p, [key]: type === 'number' ? +e.target.value : e.target.value.toUpperCase() }))}
                          className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none transition-all"
                          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                          onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.4)'}
                          onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
                      )}
                    </div>
                  ))}
                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all mt-2 disabled:opacity-50"
                    style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)', color: 'var(--accent-cyan)' }}>
                    {loading ? <><RefreshCw size={13} className="animate-spin" /> Running...</> : <><Play size={13} /> Run Backtest</>}
                  </button>
                </form>
              </div>

              {/* Run history */}
              {runs.length > 0 && (
                <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <h3 className="text-xs font-mono uppercase tracking-widest mb-3 flex items-center gap-2"
                    style={{ color: 'var(--text-muted)' }}>
                    <Clock size={11} /> History
                  </h3>
                  <div className="space-y-1.5">
                    {runs.map((r, i) => (
                      <button key={r.id || i} onClick={() => loadRun(r.id)}
                        className="w-full text-left p-2.5 rounded-lg tr-hover transition-all"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{r.symbol}</span>
                          <span className="text-xs font-mono" style={{ color: Number(r.total_return_pct) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {Number(r.total_return_pct) >= 0 ? '+' : ''}{Number(r.total_return_pct).toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {r.strategy} · {new Date(r.created_at).toLocaleDateString('en-IN')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: results */}
            <div className="xl:col-span-3 space-y-4">
              {/* Equity chart */}
              <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Equity Curve</h3>
                  {s && <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    {form.symbol} · {form.strategy}
                  </span>}
                </div>
                <EquityChart data={result?.equityCurve || []} initialCapital={form.initialCapital} height={240} />
              </div>

              {/* Summary stats */}
              {s && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 fade-in">
                  {[
                    { label: 'Total Return', value: `${s.totalReturnPct?.toFixed(2)}%`, color: s.totalReturnPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', icon: TrendingUp },
                    { label: 'Win Rate',     value: `${s.winRatePct?.toFixed(1)}%`,     color: 'var(--accent-cyan)',  icon: Activity },
                    { label: 'Sharpe',       value: s.sharpeRatio?.toFixed(3),           color: 'var(--accent-amber)', icon: BarChart2 },
                    { label: 'Max DD',       value: `${s.maxDrawdownPct?.toFixed(2)}%`,  color: 'var(--accent-red)',   icon: Shield },
                  ].map(({ label, value, color, icon: Icon }) => (
                    <div key={label} className="rounded-xl p-4"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={13} style={{ color }} />
                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{label}</span>
                      </div>
                      <div className="text-xl font-bold count-up" style={{ color }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Detailed stats + Trades */}
              {s && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 fade-in">
                  <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <h3 className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Performance</h3>
                    <StatRow label="Initial Capital"  value={`₹${Number(s.initialCapital).toLocaleString('en-IN')}`} />
                    <StatRow label="Final Capital"    value={`₹${Number(s.finalCapital).toLocaleString('en-IN')}`}   color={s.totalReturnPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'} />
                    <StatRow label="Ann. Return"      value={`${s.annualisedReturnPct?.toFixed(2)}%`} />
                    <StatRow label="Profit Factor"    value={s.profitFactor?.toFixed(2)} />
                    <StatRow label="Avg Win"          value={`${s.avgWinPct?.toFixed(2)}%`}  color="var(--accent-green)" />
                    <StatRow label="Avg Loss"         value={`${s.avgLossPct?.toFixed(2)}%`} color="var(--accent-red)" />
                  </div>
                  <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <h3 className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Trade Stats</h3>
                    <StatRow label="Total Trades"   value={s.totalTrades} />
                    <StatRow label="Winning Trades" value={s.winningTrades} color="var(--accent-green)" />
                    <StatRow label="Losing Trades"  value={s.losingTrades}  color="var(--accent-red)" />
                    <StatRow label="Win Rate"       value={`${s.winRatePct?.toFixed(1)}%`} />
                    <StatRow label="Period"         value={`${s.startDate} → ${s.endDate}`} />
                  </div>
                  <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <h3 className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Risk Metrics</h3>
                    <StatRow label="Sharpe Ratio"   value={s.sharpeRatio?.toFixed(4)} />
                    <StatRow label="Max Drawdown"   value={`${s.maxDrawdownPct?.toFixed(2)}%`} color="var(--accent-red)" />
                    <StatRow label="Stop Loss"      value={`${(form.stopLossPct * 100).toFixed(1)}%`} />
                    <StatRow label="Take Profit"    value={`${(form.takeProfitPct * 100).toFixed(1)}%`} />
                    <StatRow label="Risk/Trade"     value={`${(form.riskPerTrade * 100).toFixed(1)}%`} />
                  </div>
                </div>
              )}

              {/* Trade table */}
              {trades.length > 0 && (
                <div className="rounded-xl p-5 fade-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <h3 className="text-xs font-mono uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
                    Trade Log · {trades.length} trades
                  </h3>
                  <TradesTable trades={trades} loading={loading} />
                </div>
              )}

              {/* Empty state */}
              {!result && !loading && (
                <div className="rounded-xl p-12 flex flex-col items-center justify-center text-center"
                  style={{ background: 'var(--bg-card)', border: '1px dashed var(--border)' }}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                    style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid var(--border)' }}>
                    <BarChart2 size={28} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <p className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>No Results Yet</p>
                  <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
                    Configure the parameters and click "Run Backtest"
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}