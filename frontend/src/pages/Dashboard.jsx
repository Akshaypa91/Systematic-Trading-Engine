import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { backtestAPI, tradeAPI, signalAPI } from '../services/api';
import { useWS } from '../context/WSContext';
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

function FormField({ label, children }) {
  return (
    <div>
      <label className="section-label" style={{ display:'block', marginBottom:5 }}>{label}</label>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { portfolio: livePortfolio } = useWS();

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

  const showToast = useCallback((msg, type='info') => setToast({ msg, type }), []);

  useEffect(() => {
    tradeAPI.getPortfolio().then(r => setPortfolio(r.data.data)).catch(()=>{});
    backtestAPI.getRuns(undefined, 5).then(r => setRecentRuns(r.data.data || [])).catch(()=>{});
  }, []);

  // Use live portfolio from WS if available
  const displayPort = livePortfolio || portfolio;

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
      backtestAPI.getRuns(undefined, 5).then(r => setRecentRuns(r.data.data || [])).catch(()=>{});
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
        {/* Page header */}
        <div className="flex items-center justify-between" style={{ marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:22, fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>Dashboard</h1>
            <p className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>
              Systematic trading engine · NSE India
            </p>
          </div>
          <button onClick={() => setShowForm(v => !v)} className="btn btn-cyan">
            <Play size={12} />
            Run Backtest
            <ChevronDown size={12} style={{ transform: showForm ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }} />
          </button>
        </div>

        {/* Backtest form */}
        {showForm && (
          <div className="card fade-in" style={{ padding:20, marginBottom:20 }}>
            <form onSubmit={runBacktest}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:12 }}>
                <div style={{ gridColumn:'span 2' }}>
                  <FormField label="Symbol">
                    <input value={btForm.symbol}
                      onChange={e => setBtForm(p => ({ ...p, symbol: e.target.value.toUpperCase() }))}
                      className="input" placeholder="RELIANCE" />
                  </FormField>
                </div>
                <div style={{ gridColumn:'span 2' }}>
                  <FormField label="Strategy">
                    <select value={btForm.strategy}
                      onChange={e => setBtForm(p => ({ ...p, strategy: e.target.value }))}
                      className="input">
                      {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </FormField>
                </div>
                <FormField label="Start Date">
                  <input type="date" value={btForm.startDate}
                    onChange={e => setBtForm(p => ({ ...p, startDate: e.target.value }))} className="input" />
                </FormField>
                <FormField label="End Date">
                  <input type="date" value={btForm.endDate}
                    onChange={e => setBtForm(p => ({ ...p, endDate: e.target.value }))} className="input" />
                </FormField>
                <FormField label="Capital (₹)">
                  <input type="number" value={btForm.initialCapital}
                    onChange={e => setBtForm(p => ({ ...p, initialCapital: +e.target.value }))} className="input" />
                </FormField>
                <FormField label="Stop Loss %">
                  <input type="number" step="0.01" value={btForm.stopLossPct}
                    onChange={e => setBtForm(p => ({ ...p, stopLossPct: +e.target.value }))} className="input" />
                </FormField>
                <FormField label="Take Profit %">
                  <input type="number" step="0.01" value={btForm.takeProfitPct}
                    onChange={e => setBtForm(p => ({ ...p, takeProfitPct: +e.target.value }))} className="input" />
                </FormField>
              </div>

              {/* Quick symbol chips */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:14, paddingTop:14, borderTop:'1px solid var(--border)' }}>
                <span className="section-label" style={{ alignSelf:'center' }}>Quick select:</span>
                {VALID_SYMBOLS.map(sym => (
                  <button key={sym} type="button" onClick={() => setBtForm(p => ({ ...p, symbol: sym }))}
                    className="font-mono" style={{ padding:'3px 9px', borderRadius:5, fontSize:10, cursor:'pointer', transition:'all 0.15s',
                      background: btForm.symbol === sym ? 'rgba(0,212,255,0.12)' : 'var(--bg-elevated)',
                      border: `1px solid ${btForm.symbol === sym ? 'rgba(0,212,255,0.35)' : 'var(--border)'}`,
                      color: btForm.symbol === sym ? 'var(--cyan)' : 'var(--text-muted)' }}>
                    {sym}
                  </button>
                ))}
              </div>

              <div style={{ marginTop:14, display:'flex', alignItems:'center', gap:12 }}>
                <button type="submit" disabled={btLoading} className="btn btn-cyan">
                  {btLoading ? <><RefreshCw size={12} className="animate-spin" /> Running…</> : <><Play size={12} />Run Backtest</>}
                </button>
                {btLoading && <span className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>Fetching data & computing signals…</span>}
              </div>
            </form>
          </div>
        )}

        {/* Metrics row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:16, marginBottom:20 }}>
          <MetricsCard label="Total Return" icon={TrendingUp}
            value={s ? `${s.totalReturnPct?.toFixed(2)}%` : displayPort ? `₹${Number(displayPort.equity || 0).toLocaleString('en-IN', { maximumFractionDigits:0 })}` : null}
            sub={s ? `₹${Number(s.finalCapital).toLocaleString('en-IN', { maximumFractionDigits:0 })}` : 'Portfolio equity'}
            color={s ? (s.totalReturnPct >= 0 ? 'green' : 'red') : 'cyan'}
            trend={s?.totalReturnPct} />
          <MetricsCard label="Win Rate" icon={Activity}
            value={s ? `${s.winRatePct?.toFixed(1)}%` : null}
            sub={s ? `${s.winningTrades}W / ${s.losingTrades}L of ${s.totalTrades}` : 'Winning trades ratio'}
            color="cyan" />
          <MetricsCard label="Sharpe Ratio" icon={BarChart2}
            value={s ? s.sharpeRatio?.toFixed(3) : null}
            sub="Risk-adjusted return"
            color={s ? (s.sharpeRatio >= 1 ? 'green' : 'amber') : 'amber'} />
          <MetricsCard label="Max Drawdown" icon={Shield}
            value={s ? `${s.maxDrawdownPct?.toFixed(2)}%` : null}
            sub={s ? `Profit factor: ${s.profitFactor?.toFixed(2)}` : 'Peak-to-trough'}
            color="red" />
        </div>

        {/* Main grid */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:16, marginBottom:16 }}>
          {/* Equity chart */}
          <div className="card fade-up stagger-1" style={{ padding:20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom:16 }}>
              <div>
                <div className="section-label" style={{ marginBottom:4 }}>Equity Curve</div>
                <p className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>
                  {s ? `${btForm.symbol} · ${btForm.strategy} · ₹${Number(btForm.initialCapital).toLocaleString('en-IN')} initial` : 'Run a backtest to visualize'}
                </p>
              </div>
              {s && btResult?.equityCurve && (
                <span className="font-mono" style={{ fontSize:10, padding:'2px 8px', borderRadius:5, background:'var(--bg-elevated)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>
                  {btResult.equityCurve.length} pts
                </span>
              )}
            </div>
            <EquityChart data={btResult?.equityCurve || []} initialCapital={btForm.initialCapital} height={260} />
          </div>

          {/* Signals */}
          <div className="card fade-up stagger-2" style={{ padding:20, minHeight:380 }}>
            <SignalsPanel />
          </div>
        </div>

        {/* Trades + Recent runs */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16 }}>
          <div className="card fade-up stagger-3" style={{ padding:20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom:16 }}>
              <div className="section-label">Trade History</div>
              <span className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>
                {trades.length ? `${trades.length} trades` : 'Backtest results'}
              </span>
            </div>
            <TradesTable trades={trades} loading={btLoading} />
          </div>

          <div className="card fade-up stagger-4" style={{ padding:20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom:16 }}>
              <div className="section-label">Recent Runs</div>
              <Clock size={12} style={{ color:'var(--text-muted)' }} />
            </div>
            {recentRuns.length === 0 ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'32px 0' }}>
                <p className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>No saved runs</p>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {recentRuns.map((run, i) => (
                  <div key={run.id || i} className="card-elevated"
                    style={{ padding:'10px 14px', borderRadius:10, cursor:'pointer', transition:'all 0.15s' }}
                    onClick={async () => {
                      try {
                        const r = await backtestAPI.getTrades(run.id);
                        setTrades(r.data.data || []);
                        showToast(`Loaded run #${run.id}`, 'info');
                      } catch {}
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-bright)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div className="flex items-center justify-between" style={{ marginBottom:4 }}>
                      <span className="font-mono" style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)' }}>{run.symbol}</span>
                      <span className="font-mono" style={{ fontSize:12, fontWeight:600, color: Number(run.total_return_pct) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {Number(run.total_return_pct) >= 0 ? '+' : ''}{Number(run.total_return_pct).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>{run.strategy}</span>
                      <span className="font-mono" style={{ fontSize:10, color:'var(--text-muted)' }}>
                        {new Date(run.created_at).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick signal check */}
        <div className="card fade-up" style={{ padding:20, marginTop:16 }}>
          <div className="section-label" style={{ marginBottom:12 }}>Quick Signal Check</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {VALID_SYMBOLS.map(sym => (
              <button key={sym} className="btn btn-ghost"
                onClick={async () => {
                  try {
                    const res = await signalAPI.get(sym);
                    const d = res.data;
                    const type = d.signal === 'BUY' ? 'success' : d.signal === 'SELL' ? 'error' : 'info';
                    showToast(`${sym}: ${d.signal} · ${Math.round(d.confidence * 100)}% confidence`, type);
                  } catch (e) { showToast(`${sym}: ${e.response?.data?.error || 'Error'}`, 'error'); }
                }}>
                <Zap size={10} />{sym}
              </button>
            ))}
          </div>
        </div>
      </main>

      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
