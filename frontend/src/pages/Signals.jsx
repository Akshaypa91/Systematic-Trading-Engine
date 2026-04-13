import { useState, useEffect, useRef, useCallback } from 'react';
import { signalAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Plus, X,
  Bell, BellOff, Clock, Zap, Activity, ChevronDown, ChevronUp
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis
} from 'recharts';

const STRATEGIES   = ['AGGREGATED', 'RSI', 'MA_CROSSOVER', 'MEAN_REVERSION'];
const VALID_SYMBOLS = ['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','WIPRO','SBIN','AXISBANK'];
const AUTO_REFRESH_OPTIONS = [0, 30, 60, 120, 300]; // seconds; 0 = off

// ── Signal config ─────────────────────────────────────────────────────────────
const SIG_CFG = {
  BUY:  { color: 'var(--green)', bg: 'rgba(0,230,118,0.08)',  border: 'rgba(0,230,118,0.25)',  icon: TrendingUp },
  SELL: { color: 'var(--red)',   bg: 'rgba(255,71,87,0.08)',  border: 'rgba(255,71,87,0.25)',  icon: TrendingDown },
  HOLD: { color: 'var(--amber)', bg: 'rgba(255,167,38,0.08)', border: 'rgba(255,167,38,0.25)', icon: Minus },
};

// ── Helper components ─────────────────────────────────────────────────────────

function ConfidenceRing({ value = 0 }) {
  const pct   = Math.round(value * 100);
  const r     = 28, circ = 2 * Math.PI * r;
  const dash  = (pct / 100) * circ;
  const color = pct > 65 ? 'var(--green)' : pct > 35 ? 'var(--cyan)' : 'var(--amber)';
  return (
    <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
      <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s' }} />
      </svg>
      <div className="absolute text-center">
        <div className="text-sm font-bold font-mono" style={{ color }}>{pct}%</div>
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)', fontSize: 9 }}>CONF</div>
      </div>
    </div>
  );
}

function SignalCard({ data, onRemove, alertEnabled, onToggleAlert }) {
  const [expanded, setExpanded] = useState(false);
  const { signal, confidence, symbol, strategy, currentPrice, zScore, rsiValue, maFast, maSlow, ts } = data;
  const c    = SIG_CFG[signal] || SIG_CFG.HOLD;
  const Icon = c.icon;

  // Radar chart for this card
  const radarData = [
    { subject: 'Conf',    value: Math.round((confidence || 0) * 100) },
    { subject: 'RSI',     value: rsiValue != null ? Math.round(rsiValue) : 50 },
    { subject: 'Z-Score', value: Math.min(Math.abs(zScore || 0) * 33, 100) },
    { subject: 'MA Gap',  value: maFast && maSlow ? Math.min(Math.abs((maFast - maSlow) / maSlow) * 1000, 100) : 50 },
  ];

  return (
    <div className="rounded-xl fade-in relative overflow-hidden"
      style={{ background: 'var(--bg-card)', border: `1px solid ${c.border}` }}>
      {/* Top accent line */}
      <div style={{ height: 3, background: c.color, opacity: 0.7 }} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{symbol}</div>
            <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{strategy}</div>
            {ts && <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              <Clock size={9} style={{ display: 'inline', marginRight: 3 }} />{ts}
            </div>}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => onToggleAlert(symbol)}
              className="p-1.5 rounded transition-colors"
              title={alertEnabled ? 'Alerts on' : 'Alerts off'}
              style={{ color: alertEnabled ? 'var(--amber)' : 'var(--text-muted)', background: alertEnabled ? 'rgba(255,167,38,0.1)' : 'transparent' }}>
              {alertEnabled ? <Bell size={12} /> : <BellOff size={12} />}
            </button>
            <button onClick={() => setExpanded(v => !v)}
              className="p-1.5 rounded transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <button onClick={onRemove} className="p-1.5 rounded transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Signal + ring */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-base font-bold inline-flex"
              style={{ background: c.bg, color: c.color }}>
              <Icon size={16} /> {signal}
            </div>
            {currentPrice && (
              <div className="text-xs font-mono mt-2" style={{ color: 'var(--text-secondary)' }}>
                ₹{Number(currentPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            )}
          </div>
          <ConfidenceRing value={confidence} />
        </div>

        {/* Quick indicators */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'RSI', value: rsiValue != null ? Number(rsiValue).toFixed(1) : '—', color: rsiValue > 70 ? 'var(--red)' : rsiValue < 30 ? 'var(--green)' : 'var(--text-primary)' },
            { label: 'Z-Score', value: zScore != null ? Number(zScore).toFixed(2) : '—', color: Math.abs(zScore||0) > 1.5 ? 'var(--amber)' : 'var(--text-primary)' },
            { label: 'MA Cross', value: maFast && maSlow ? (maFast > maSlow ? '▲ Bull' : '▼ Bear') : '—', color: maFast > maSlow ? 'var(--green)' : 'var(--red)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-2 rounded-lg text-center"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="text-xs font-mono" style={{ color: 'var(--text-muted)', fontSize: 9 }}>{label}</div>
              <div className="text-xs font-mono font-bold mt-0.5" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Expanded: radar chart */}
        {expanded && (
          <div className="mt-4 fade-in">
            <div className="text-xs font-mono mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Signal Breakdown</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} margin={{ top: 0, right: 20, bottom: 0, left: 20 }}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} />
                  <Radar name={symbol} dataKey="value" stroke={c.color} fill={c.color} fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {maFast && <div className="text-xs font-mono p-2 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>MA Fast: ₹{Number(maFast).toFixed(0)}</div>}
              {maSlow && <div className="text-xs font-mono p-2 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>MA Slow: ₹{Number(maSlow).toFixed(0)}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Signals() {
  const [signals,    setSignals]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [strategy,   setStrategy]   = useState('AGGREGATED');
  const [custom,     setCustom]     = useState('');
  const [toast,      setToast]      = useState(null);
  const [alerts,     setAlerts]     = useState({});      // symbol → bool
  const [autoRefresh,setAutoRefresh]= useState(0);       // seconds
  const [countdown,  setCountdown]  = useState(0);
  const timerRef = useRef(null);
  const cdRef    = useRef(null);

  // Auto-refresh logic
  useEffect(() => {
    clearInterval(timerRef.current);
    clearInterval(cdRef.current);
    if (autoRefresh > 0 && signals.length > 0) {
      setCountdown(autoRefresh);
      cdRef.current = setInterval(() => setCountdown(v => v <= 1 ? autoRefresh : v - 1), 1000);
      timerRef.current = setInterval(() => refreshAll(), autoRefresh * 1000);
    }
    return () => { clearInterval(timerRef.current); clearInterval(cdRef.current); };
  }, [autoRefresh, signals.length]);

  async function fetchSignal(symbol) {
    if (!symbol) return;
    setLoading(true);
    try {
      const res = await signalAPI.get(symbol.toUpperCase(), strategy);
      const d   = res.data;
      const entry = {
        symbol: d.symbol, signal: d.signal, confidence: d.confidence,
        currentPrice: d.currentPrice, strategy: d.strategy || strategy,
        zScore: d.zScore, rsiValue: d.rsiValue, maFast: d.maFast, maSlow: d.maSlow,
        ts: new Date().toLocaleTimeString('en-IN', { hour12: false }),
      };
      setSignals(prev => {
        const filtered = prev.filter(s => s.symbol !== entry.symbol);
        return [entry, ...filtered];
      });
      // Check alert
      if (alerts[d.symbol] && (d.signal === 'BUY' || d.signal === 'SELL')) {
        setToast({ message: `🔔 ${d.symbol}: ${d.signal} signal (${Math.round(d.confidence * 100)}% conf)`, type: d.signal === 'BUY' ? 'success' : 'error' });
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || `Failed for ${symbol}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  const refreshAll = useCallback(async () => {
    if (!signals.length) return;
    setLoading(true);
    for (const s of signals) {
      try {
        const res = await signalAPI.get(s.symbol, strategy);
        const d   = res.data;
        setSignals(prev => prev.map(x =>
          x.symbol === d.symbol
            ? { ...x, signal: d.signal, confidence: d.confidence, currentPrice: d.currentPrice,
                zScore: d.zScore, rsiValue: d.rsiValue, maFast: d.maFast, maSlow: d.maSlow,
                ts: new Date().toLocaleTimeString('en-IN', { hour12: false }) }
            : x
        ));
      } catch {}
    }
    setLoading(false);
  }, [signals, strategy]);

  function remove(symbol) { setSignals(p => p.filter(s => s.symbol !== symbol)); }
  function toggleAlert(sym) { setAlerts(p => ({ ...p, [sym]: !p[sym] })); }

  // Comparison bar chart data
  const chartData = signals.map(s => ({
    symbol: s.symbol,
    confidence: Math.round((s.confidence || 0) * 100),
    signal: s.signal,
  }));

  // Summary counts
  const buys  = signals.filter(s => s.signal === 'BUY').length;
  const sells = signals.filter(s => s.signal === 'SELL').length;
  const holds = signals.filter(s => s.signal === 'HOLD').length;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <Sidebar />
      <main className="ml-48 pt-14 min-h-screen">
        <div className="p-6 max-w-screen-xl">

          {/* Header */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Signal Center</h1>
              <p className="text-sm font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Multi-strategy signal aggregation · Real-time alerts
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Auto-refresh selector */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <Clock size={11} />
                <select value={autoRefresh} onChange={e => setAutoRefresh(+e.target.value)}
                  className="bg-transparent outline-none text-xs font-mono"
                  style={{ color: autoRefresh > 0 ? 'var(--cyan)' : 'var(--text-secondary)' }}>
                  <option value={0}>Auto-refresh: Off</option>
                  <option value={30}>Every 30s</option>
                  <option value={60}>Every 1m</option>
                  <option value={120}>Every 2m</option>
                  <option value={300}>Every 5m</option>
                </select>
                {autoRefresh > 0 && signals.length > 0 && (
                  <span style={{ color: 'var(--cyan)' }}>{countdown}s</span>
                )}
              </div>
              {signals.length > 0 && (
                <button onClick={refreshAll} disabled={loading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                  Refresh All
                </button>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            {/* Strategy selector */}
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <span className="text-xs font-mono uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Strategy</span>
              <div className="flex gap-1 flex-wrap">
                {STRATEGIES.map(s => (
                  <button key={s} onClick={() => setStrategy(s)}
                    className="px-2.5 py-1 rounded text-xs font-mono transition-all"
                    style={{
                      background: strategy === s ? 'rgba(0,212,255,0.12)' : 'var(--bg-elevated)',
                      border: strategy === s ? '1px solid rgba(0,212,255,0.35)' : '1px solid var(--border)',
                      color: strategy === s ? 'var(--cyan)' : 'var(--text-muted)',
                    }}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick symbol chips */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              <span className="text-xs font-mono self-center uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Quick add</span>
              {VALID_SYMBOLS.map(sym => {
                const already = signals.find(s => s.symbol === sym);
                return (
                  <button key={sym} onClick={() => fetchSignal(sym)}
                    className="px-2.5 py-1 rounded text-xs font-mono transition-all relative"
                    style={{
                      background: already ? 'rgba(0,212,255,0.08)' : 'var(--bg-elevated)',
                      border: already ? '1px solid rgba(0,212,255,0.3)' : '1px solid var(--border)',
                      color: already ? 'var(--cyan)' : 'var(--text-muted)',
                    }}>
                    {sym}
                    {already && (
                      <span className="ml-1.5 text-xs" style={{
                        color: already.signal === 'BUY' ? 'var(--green)' : already.signal === 'SELL' ? 'var(--red)' : 'var(--amber)',
                        fontSize: 9,
                      }}>
                        {already.signal === 'BUY' ? '▲' : already.signal === 'SELL' ? '▼' : '—'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom symbol input */}
            <div className="flex gap-2">
              <input value={custom} onChange={e => setCustom(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter' && custom) { fetchSignal(custom); setCustom(''); }}}
                placeholder="Enter any symbol..."
                className="flex-1 px-3 py-2 rounded-lg text-xs font-mono outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.4)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
              <button onClick={() => { if (custom) { fetchSignal(custom); setCustom(''); }}}
                disabled={!custom || loading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono transition-all disabled:opacity-40"
                style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--cyan)' }}>
                <Plus size={11} /> Add Signal
              </button>
            </div>
          </div>

          {/* Summary + Chart row */}
          {signals.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              {/* Summary cards */}
              <div className="flex flex-col gap-3">
                {[
                  { label: 'BUY Signals',  count: buys,  color: 'var(--green)', icon: TrendingUp },
                  { label: 'SELL Signals', count: sells, color: 'var(--red)',   icon: TrendingDown },
                  { label: 'HOLD',         count: holds, color: 'var(--amber)', icon: Minus },
                ].map(({ label, count, color, icon: Icon }) => (
                  <div key={label} className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${color}15`, border: `1px solid ${color}35` }}>
                      <Icon size={14} style={{ color }} />
                    </div>
                    <div>
                      <div className="text-lg font-bold font-mono" style={{ color }}>{count}</div>
                      <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Confidence comparison chart */}
              <div className="lg:col-span-2 rounded-xl p-5"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-mono uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>
                  Confidence Comparison
                </div>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                      <XAxis dataKey="symbol" tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={[0, 100]} />
                      <Tooltip
                        formatter={v => [`${v}%`, 'Confidence']}
                        contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                        labelStyle={{ color: 'var(--text-secondary)' }} />
                      <Bar dataKey="confidence" radius={[4, 4, 0, 0]} maxBarSize={40}>
                        {chartData.map((entry, i) => (
                          <Cell key={i} fill={
                            entry.signal === 'BUY'  ? 'var(--green)' :
                            entry.signal === 'SELL' ? 'var(--red)'   : 'var(--amber)'
                          } fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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
                Click a symbol chip above or type one in the input
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {signals.map(s => (
                <SignalCard
                  key={s.symbol}
                  data={s}
                  onRemove={() => remove(s.symbol)}
                  alertEnabled={!!alerts[s.symbol]}
                  onToggleAlert={toggleAlert}
                />
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