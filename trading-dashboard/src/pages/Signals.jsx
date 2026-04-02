import { useState } from 'react';
import { signalAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Plus, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const STRATEGIES = ['AGGREGATED', 'RSI', 'MA_CROSSOVER', 'MEAN_REVERSION'];
const QUICK_SYMBOLS = ['RELIANCE','TCS','INFY','HDFC','ICICIBANK','WIPRO','HDFCBANK','SBIN','AXISBANK','LT','KOTAKBANK','BAJFINANCE'];

function SignalCard({ data, onRemove }) {
  const { signal, confidence, symbol, strategy, currentPrice, zScore, rsiValue, maFast, maSlow } = data;
  const cfg = {
    BUY:  { color: 'var(--accent-green)', bg: 'rgba(0,230,118,0.08)',  border: 'rgba(0,230,118,0.2)',  icon: TrendingUp },
    SELL: { color: 'var(--accent-red)',   bg: 'rgba(255,71,87,0.08)',  border: 'rgba(255,71,87,0.2)',  icon: TrendingDown },
    HOLD: { color: 'var(--accent-amber)', bg: 'rgba(255,167,38,0.08)', border: 'rgba(255,167,38,0.2)', icon: Minus },
  };
  const c = cfg[signal] || cfg.HOLD;
  const Icon = c.icon;
  const pct = Math.round((confidence || 0) * 100);

  return (
    <div className="rounded-xl p-5 fade-in relative"
      style={{ background: 'var(--bg-card)', border: `1px solid ${c.border}` }}>
      <button onClick={onRemove}
        className="absolute top-3 right-3 p-1 rounded transition-colors"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-red)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
        <X size={12} />
      </button>

      <div className="flex items-start justify-between mb-3 pr-4">
        <div>
          <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{symbol}</div>
          <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{strategy}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold"
            style={{ background: c.bg, color: c.color }}>
            <Icon size={14} /> {signal}
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs font-mono mb-1">
          <span style={{ color: 'var(--text-muted)' }}>Confidence</span>
          <span style={{ color: c.color }}>{pct}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: c.color }} />
        </div>
      </div>

      {/* Indicators */}
      <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
        {currentPrice != null && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Price</div>
            <div style={{ color: 'var(--text-primary)' }}>₹{Number(currentPrice).toLocaleString('en-IN')}</div>
          </div>
        )}
        {rsiValue != null && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)' }}>
            <div style={{ color: 'var(--text-muted)' }}>RSI</div>
            <div style={{ color: rsiValue > 70 ? 'var(--accent-red)' : rsiValue < 30 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
              {Number(rsiValue).toFixed(2)}
            </div>
          </div>
        )}
        {zScore != null && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Z-Score</div>
            <div style={{ color: 'var(--text-primary)' }}>{Number(zScore).toFixed(3)}</div>
          </div>
        )}
        {maFast != null && (
          <div className="px-2 py-1.5 rounded" style={{ background: 'var(--bg-elevated)' }}>
            <div style={{ color: 'var(--text-muted)' }}>MA Fast</div>
            <div style={{ color: 'var(--text-primary)' }}>{Number(maFast).toFixed(2)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Signals() {
  const [signals,   setSignals]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [strategy,  setStrategy]  = useState('AGGREGATED');
  const [custom,    setCustom]    = useState('');
  const [toast,     setToast]     = useState(null);

  async function fetch(symbol) {
    if (!symbol) return;
    setLoading(true);
    try {
      const res = await signalAPI.get(symbol, strategy);
      setSignals(prev => {
        const filtered = prev.filter(s => s.symbol !== symbol.toUpperCase());
        return [res.data, ...filtered];
      });
    } catch (err) {
      setToast({ message: err.response?.data?.error || `Failed for ${symbol}`, type: 'error' });
    } finally { setLoading(false); }
  }

  async function fetchAll() {
    if (!signals.length) return;
    setLoading(true);
    for (const s of signals) { await fetch(s.symbol).catch(() => {}); }
    setLoading(false);
  }

  function remove(symbol) {
    setSignals(p => p.filter(s => s.symbol !== symbol));
  }

  // Chart data for confidence comparison
  const chartData = signals.map(s => ({
    symbol: s.symbol,
    confidence: Math.round((s.confidence || 0) * 100),
    signal: s.signal,
  }));

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <Sidebar />
      <main className="ml-48 pt-14 min-h-screen">
        <div className="p-6 max-w-screen-xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Signal Center</h1>
              <p className="text-sm font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Multi-strategy signal aggregation
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex flex-wrap gap-3 items-center">
              {/* Strategy selector */}
              <div>
                <label className="text-xs font-mono block mb-1" style={{ color: 'var(--text-muted)' }}>Strategy</label>
                <div className="flex gap-1">
                  {STRATEGIES.map(s => (
                    <button key={s} onClick={() => setStrategy(s)}
                      className="px-2.5 py-1 rounded text-xs font-mono transition-all"
                      style={{
                        background: strategy === s ? 'rgba(0,212,255,0.12)' : 'var(--bg-elevated)',
                        border: strategy === s ? '1px solid rgba(0,212,255,0.35)' : '1px solid var(--border)',
                        color: strategy === s ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      }}>
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom symbol */}
              <div className="flex items-end gap-2 ml-auto">
                <div>
                  <label className="text-xs font-mono block mb-1" style={{ color: 'var(--text-muted)' }}>Custom Symbol</label>
                  <div className="flex gap-2">
                    <input value={custom} onChange={e => setCustom(e.target.value.toUpperCase())}
                      onKeyDown={e => { if (e.key === 'Enter') { fetch(custom); setCustom(''); }}}
                      placeholder="SYMBOL"
                      className="px-3 py-1.5 rounded text-xs font-mono outline-none w-32"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.4)'}
                      onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
                    <button onClick={() => { fetch(custom); setCustom(''); }} disabled={!custom || loading}
                      className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono transition-all disabled:opacity-40"
                      style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--accent-cyan)' }}>
                      <Plus size={11} /> Add
                    </button>
                  </div>
                </div>
                {signals.length > 0 && (
                  <button onClick={fetchAll} disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh All
                  </button>
                )}
              </div>
            </div>

            {/* Quick symbol chips */}
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              {QUICK_SYMBOLS.map(sym => (
                <button key={sym} onClick={() => fetch(sym)}
                  className="px-2.5 py-1 rounded text-xs font-mono transition-all"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,212,255,0.4)'; e.currentTarget.style.color = 'var(--accent-cyan)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                  {sym}
                </button>
              ))}
            </div>
          </div>

          {/* Confidence chart */}
          {chartData.length > 1 && (
            <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-mono uppercase tracking-widest mb-4" style={{ color: 'var(--text-muted)' }}>
                Confidence Comparison
              </h3>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <XAxis dataKey="symbol" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} domain={[0, 100]} />
                    <Tooltip
                      formatter={(v) => [`${v}%`, 'Confidence']}
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', borderRadius: 6, fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                      labelStyle={{ color: 'var(--text-secondary)' }}
                    />
                    <Bar dataKey="confidence" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.signal === 'BUY' ? 'var(--accent-green)' : entry.signal === 'SELL' ? 'var(--accent-red)' : 'var(--accent-amber)'} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Signal cards grid */}
          {signals.length === 0 ? (
            <div className="rounded-xl p-16 flex flex-col items-center justify-center text-center"
              style={{ background: 'var(--bg-card)', border: '1px dashed var(--border)' }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid var(--border)' }}>
                <Activity size={24} style={{ color: 'var(--text-muted)' }} />
              </div>
              <p className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>No Signals Yet</p>
              <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
                Click a symbol above or type one in the input
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {signals.map((s) => (
                <SignalCard key={s.symbol} data={s} onRemove={() => remove(s.symbol)} />
              ))}
            </div>
          )}
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

function Activity({ size, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
