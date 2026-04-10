// src/pages/LiveTrading.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { simAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, Activity,
  DollarSign, BarChart2, RefreshCw, Zap,
  Shield, Play, Square, AlertCircle, Clock,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────

function SignalBadge({ signal }) {
  const cfg = {
    BUY:  { bg: 'rgba(0,230,118,0.14)', border: 'rgba(0,230,118,0.45)', color: '#00e676', Icon: TrendingUp   },
    SELL: { bg: 'rgba(255,71,87,0.14)',  border: 'rgba(255,71,87,0.45)',  color: '#ff4757', Icon: TrendingDown },
    HOLD: { bg: 'rgba(255,167,38,0.14)', border: 'rgba(255,167,38,0.45)', color: '#ffa726', Icon: Minus        },
  };
  const c = cfg[signal] || cfg.HOLD;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      <c.Icon size={9} /> {signal || 'HOLD'}
    </span>
  );
}

function ConfBar({ value = 0 }) {
  const pct   = Math.round(value * 100);
  const color = pct > 65 ? '#00e676' : pct > 40 ? '#ffa726' : '#ff4757';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color, transition: 'width 0.5s ease' }} />
      </div>
      <span className="text-xs font-mono w-7 text-right" style={{ color: '#555' }}>{pct}%</span>
    </div>
  );
}

function StatCard({ label, value, sub, color = '#00d4ff', Icon, blink = false }) {
  return (
    <div className="rounded-xl p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#555' }}>
          {label}
        </span>
        {Icon && <Icon size={14} style={{ color, opacity: 0.7 }} />}
      </div>
      <div className="text-xl font-bold leading-none" style={{ color }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div className="text-xs font-mono mt-1.5" style={{ color: '#555' }}>{sub}</div>
      )}
    </div>
  );
}

function PulsingDot({ active }) {
  return (
    <div className="relative w-2 h-2 flex-shrink-0">
      <div className="absolute inset-0 rounded-full"
        style={{ background: active ? '#00e676' : '#555' }} />
      {active && (
        <div className="absolute inset-0 rounded-full animate-ping"
          style={{ background: '#00e676', opacity: 0.4 }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Equity chart tooltip
// ─────────────────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-lg text-xs font-mono"
      style={{ background: '#111827', border: '1px solid #2a2a3a', color: '#ccc' }}>
      <div style={{ color: '#00d4ff', fontWeight: 700 }}>
        ₹{(payload[0].value * 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      <div style={{ color: '#444', marginTop: 2 }}>{payload[0].payload.t}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 4000; // ms

export default function LiveTrading() {
  const [signals,    setSignals]    = useState([]);
  const [portfolio,  setPortfolio]  = useState(null);
  const [trades,     setTrades]     = useState([]);
  const [equityRaw,  setEquityRaw]  = useState([]);
  const [running,    setRunning]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [filter,     setFilter]     = useState('ALL');
  const [tickFlash,  setTickFlash]  = useState(false);
  const intervalRef = useRef(null);
  const prevEquity  = useRef(null);

  // ── Fetch all panels in one parallel burst ──────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [sigRes, portRes, tradesRes, equityRes] = await Promise.allSettled([
        simAPI.getSignals(),
        simAPI.getPortfolio(),
        simAPI.getTrades(50),
        simAPI.getEquity(),
      ]);

      if (sigRes.status === 'fulfilled') {
        const sigs = sigRes.value.data.signals || [];
        setRunning(sigRes.value.data.status?.running || false);
        setSignals(sigs);
        // Flash tick indicator on new data
        setTickFlash(true);
        setTimeout(() => setTickFlash(false), 400);
      }

      if (portRes.status === 'fulfilled') {
        setPortfolio(portRes.value.data.data);
      }

      if (tradesRes.status === 'fulfilled') {
        setTrades(tradesRes.value.data.data || []);
      }

      if (equityRes.status === 'fulfilled') {
        const raw = equityRes.value.data.data || [];
        // Downsample: keep max 150 points for smooth chart perf
        const step = Math.max(1, Math.floor(raw.length / 150));
        const sampled = raw
          .filter((_, i) => i % step === 0 || i === raw.length - 1)
          .map(p => ({
            t: new Date(p.t).toLocaleTimeString('en-IN', { hour12: false }),
            equity: parseFloat((p.equity / 1000).toFixed(2)),
          }));
        setEquityRaw(sampled);
      }

      setLastUpdate(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    } catch (_) {}
  }, []);

  // ── Start engine via API (in case it's not already running) ────────────
  const handleStart = useCallback(async () => {
    setLoading(true);
    try {
      await simAPI.startEngine({
        watchlist: [
          'RELIANCE','INFY','TCS','HDFCBANK','ICICIBANK',
          'WIPRO','SBIN','AXISBANK','BAJFINANCE','MARUTI',
        ],
        intervalMs: 4000,
      });
      setRunning(true);
      await fetchAll();
    } catch (_) {}
    setLoading(false);
  }, [fetchAll]);

  const handleStop = useCallback(async () => {
    try { await simAPI.stopEngine(); } catch (_) {}
    setRunning(false);
  }, []);

  // ── Bootstrap: fetch immediately + start polling ────────────────────────
  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  // ── Derived values ────────────────────────────────────────────────────
  const p             = portfolio;
  const returnPct     = p?.totalReturn ?? 0;
  const returnColor   = returnPct >= 0 ? '#00e676' : '#ff4757';
  const initialK      = p ? (p.initialCapital / 1000).toFixed(0) : '1000';

  const filteredSigs  = filter === 'ALL'
    ? signals
    : signals.filter(s => s.signal === filter);

  const buyCount  = signals.filter(s => s.signal === 'BUY').length;
  const sellCount = signals.filter(s => s.signal === 'SELL').length;
  const winTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate   = trades.length > 0 ? ((winTrades / trades.length) * 100).toFixed(0) : null;

  // Equity chart Y-axis domain with 0.5% padding
  const equityValues = equityRaw.map(d => d.equity);
  const eMin = equityValues.length ? Math.min(...equityValues) * 0.998 : 900;
  const eMax = equityValues.length ? Math.max(...equityValues) * 1.002 : 1100;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Navbar />
      <Sidebar />

      <main className="ml-48 pt-14 min-h-screen">
        <div className="p-6 max-w-screen-2xl">

          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Live Trading
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs font-mono" style={{ color: '#555' }}>
                  Simulation mode · paper trading
                </span>
                {lastUpdate && (
                  <span className="flex items-center gap-1 text-xs font-mono"
                    style={{ color: tickFlash ? '#00d4ff' : '#444', transition: 'color 0.3s' }}>
                    <Clock size={10} /> {lastUpdate}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Live / Stopped badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{
                  background:  running ? 'rgba(0,230,118,0.07)' : 'rgba(255,71,87,0.07)',
                  border: `1px solid ${running ? 'rgba(0,230,118,0.3)' : 'rgba(255,71,87,0.3)'}`,
                }}>
                <PulsingDot active={running} />
                <span className="text-xs font-mono font-semibold"
                  style={{ color: running ? '#00e676' : '#ff4757' }}>
                  {running ? 'LIVE' : 'STOPPED'}
                </span>
              </div>

              {/* Start / Stop */}
              {!running ? (
                <button onClick={handleStart} disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold
                             transition-all disabled:opacity-50 hover:brightness-125"
                  style={{
                    background: 'rgba(0,230,118,0.12)',
                    border: '1px solid rgba(0,230,118,0.35)',
                    color: '#00e676',
                  }}>
                  {loading
                    ? <RefreshCw size={12} className="animate-spin" />
                    : <Play size={12} />}
                  Start Engine
                </button>
              ) : (
                <button onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold
                             hover:brightness-125 transition-all"
                  style={{
                    background: 'rgba(255,71,87,0.10)',
                    border: '1px solid rgba(255,71,87,0.3)',
                    color: '#ff4757',
                  }}>
                  <Square size={12} /> Stop
                </button>
              )}

              {/* Manual refresh */}
              <button onClick={fetchAll} title="Refresh now"
                className="p-2 rounded-lg transition-colors hover:brightness-125"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: '#555' }}>
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* ── Signal Bar (BUY / SELL / HOLD summary) ───────────────────── */}
          <div className="flex items-center gap-2 mb-5 px-4 py-3 rounded-xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <span className="text-xs font-mono" style={{ color: '#555' }}>SIGNAL MIX</span>
            <div className="flex-1 flex items-center gap-1 mx-3 h-2 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              {signals.length > 0 && <>
                <div style={{ width: `${(buyCount / signals.length) * 100}%`, background: '#00e676', height: '100%', transition: 'width 0.5s' }} />
                <div style={{ width: `${(sellCount / signals.length) * 100}%`, background: '#ff4757', height: '100%', transition: 'width 0.5s' }} />
                <div style={{ flex: 1, background: '#ffa726', height: '100%' }} />
              </>}
            </div>
            <div className="flex gap-4 text-xs font-mono">
              <span style={{ color: '#00e676' }}>▲ {buyCount} BUY</span>
              <span style={{ color: '#ff4757' }}>▼ {sellCount} SELL</span>
              <span style={{ color: '#ffa726' }}>— {signals.length - buyCount - sellCount} HOLD</span>
            </div>
          </div>

          {/* ── Stats Row ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <StatCard
              label="Portfolio Equity"
              value={p
                ? `₹${p.equity.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                : '—'}
              sub={p ? `Initial ₹${(p.initialCapital / 1e5).toFixed(0)}L` : ''}
              color="#00d4ff"
              Icon={DollarSign}
            />
            <StatCard
              label="Total Return"
              value={p ? `${returnPct >= 0 ? '+' : ''}${returnPct}%` : '—'}
              sub={p
                ? `P&L ₹${p.totalPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                : ''}
              color={p ? returnColor : '#00d4ff'}
              Icon={TrendingUp}
            />
            <StatCard
              label="Open Positions"
              value={p ? p.openPositionCount : '—'}
              sub={p
                ? `Unrealized ₹${p.openPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                : ''}
              color="#ffa726"
              Icon={Activity}
            />
            <StatCard
              label="Win Rate"
              value={winRate != null ? `${winRate}%` : '—'}
              sub={`${winTrades}W / ${trades.length - winTrades}L of ${trades.length} trades`}
              color="#a78bfa"
              Icon={BarChart2}
            />
          </div>

          {/* ── Main grid: Equity Curve + Open Positions ──────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

            {/* Equity curve */}
            <div className="lg:col-span-2 rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xs font-mono uppercase tracking-widest"
                    style={{ color: '#555' }}>Equity Curve</h2>
                  <p className="text-xs font-mono mt-0.5" style={{ color: '#444' }}>
                    Portfolio value in ₹K · live paper simulation
                  </p>
                </div>
                {equityRaw.length > 0 && (
                  <span className="text-xs font-mono px-2 py-1 rounded"
                    style={{ background: 'var(--bg-elevated)', color: '#555', border: '1px solid var(--border)' }}>
                    {equityRaw.length} pts
                  </span>
                )}
              </div>

              {equityRaw.length < 3 ? (
                <div className="flex flex-col items-center justify-center h-52 gap-2">
                  <div className="text-xs font-mono" style={{ color: '#444' }}>
                    {running ? '⏳  Collecting equity data...' : 'Start the engine to see live equity curve'}
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={equityRaw} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="t"
                      tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                      interval={Math.max(1, Math.floor(equityRaw.length / 7))}
                      tickLine={false} axisLine={false}
                    />
                    <YAxis
                      domain={[eMin, eMax]}
                      tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                      tickLine={false} axisLine={false}
                      tickFormatter={v => `₹${v}K`} width={62}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine
                      y={p ? p.initialCapital / 1000 : parseFloat(initialK)}
                      stroke="rgba(255,255,255,0.12)"
                      strokeDasharray="4 4"
                    />
                    <Line
                      type="monotone" dataKey="equity"
                      stroke="#00d4ff" strokeWidth={2}
                      dot={false} isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Open positions */}
            <div className="rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Shield size={13} style={{ color: '#555' }} />
                  <h2 className="text-xs font-mono uppercase tracking-widest"
                    style={{ color: '#555' }}>Open Positions</h2>
                </div>
                {p && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: '#555',
                    }}>
                    {p.openPositionCount} open
                  </span>
                )}
              </div>

              {(!p || p.openPositionCount === 0) ? (
                <div className="flex flex-col items-center justify-center h-44 gap-2">
                  <BarChart2 size={22} style={{ color: '#333' }} />
                  <span className="text-xs font-mono" style={{ color: '#444' }}>
                    No open positions
                  </span>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 300 }}>
                  {Object.entries(p.openPositions).map(([sym, pos]) => {
                    const pnlColor = pos.unrealizedPnl >= 0 ? '#00e676' : '#ff4757';
                    const pnlPct   = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2);
                    return (
                      <div key={sym} className="p-3 rounded-lg"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                            {sym}
                          </span>
                          <div className="text-right">
                            <span className="text-xs font-mono font-semibold" style={{ color: pnlColor }}>
                              {pos.unrealizedPnl >= 0 ? '+' : ''}
                              ₹{Math.abs(pos.unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </span>
                            <span className="text-xs font-mono ml-1" style={{ color: pnlColor, opacity: 0.7 }}>
                              ({pnlPct}%)
                            </span>
                          </div>
                        </div>
                        <div className="text-xs font-mono mb-1.5"
                          style={{ color: '#555' }}>
                          {pos.qty} shares · Entry ₹{pos.entryPrice.toLocaleString('en-IN')}
                          → Now ₹{pos.currentPrice?.toLocaleString('en-IN') || '—'}
                        </div>
                        <div className="flex gap-3 text-xs font-mono" style={{ color: '#444' }}>
                          <span style={{ color: 'rgba(255,71,87,0.7)' }}>SL ₹{pos.stopLoss}</span>
                          <span style={{ color: 'rgba(0,230,118,0.7)' }}>TP ₹{pos.takeProfit}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Bottom grid: Signals + Trade History ──────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Live Signals */}
            <div className="rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <PulsingDot active={running} />
                  <h2 className="text-xs font-mono uppercase tracking-widest"
                    style={{ color: '#555' }}>Live Signals</h2>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-elevated)', color: '#555', border: '1px solid var(--border)' }}>
                    {signals.length}
                  </span>
                </div>

                {/* Filter chips */}
                <div className="flex gap-1">
                  {['ALL', 'BUY', 'SELL', 'HOLD'].map(f => {
                    const colors = {
                      ALL:  '#00d4ff', BUY: '#00e676',
                      SELL: '#ff4757', HOLD: '#ffa726',
                    };
                    const active = filter === f;
                    return (
                      <button key={f} onClick={() => setFilter(f)}
                        className="px-2 py-0.5 rounded text-xs font-mono transition-all"
                        style={{
                          background: active ? `${colors[f]}18` : 'var(--bg-elevated)',
                          border: `1px solid ${active ? colors[f] + '55' : 'var(--border)'}`,
                          color: active ? colors[f] : '#555',
                        }}>
                        {f}
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredSigs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-2">
                  <AlertCircle size={22} style={{ color: '#333' }} />
                  <span className="text-xs font-mono" style={{ color: '#444' }}>
                    {running ? 'Generating signals...' : 'Start the engine to generate signals'}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto pr-0.5"
                  style={{ maxHeight: 420 }}>
                  {filteredSigs.map(s => (
                    <div key={s.symbol}
                      className="p-3 rounded-lg transition-all hover:brightness-110"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-sm font-bold"
                            style={{ color: 'var(--text-primary)' }}>{s.symbol}</span>
                          <span className="text-xs font-mono ml-2" style={{ color: '#555' }}>
                            ₹{s.currentPrice?.toLocaleString('en-IN') || '—'}
                          </span>
                        </div>
                        <SignalBadge signal={s.signal} />
                      </div>

                      <ConfBar value={s.confidence} />

                      <div className="grid grid-cols-3 gap-1 mt-2 text-xs font-mono"
                        style={{ color: '#444' }}>
                        <span>RSI {s.rsi ?? '—'}</span>
                        <span className="text-center truncate">{s.regime || '—'}</span>
                        <span className="text-right">
                          {new Date(s.timestamp).toLocaleTimeString('en-IN', { hour12: false })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Trade History */}
            <div className="rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity size={13} style={{ color: '#555' }} />
                  <h2 className="text-xs font-mono uppercase tracking-widest"
                    style={{ color: '#555' }}>Paper Trade History</h2>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono" style={{ color: '#555' }}>
                  {trades.length > 0 && (
                    <>
                      <span style={{ color: '#00e676' }}>{winTrades}W</span>
                      <span>/</span>
                      <span style={{ color: '#ff4757' }}>{trades.length - winTrades}L</span>
                    </>
                  )}
                  <span className="px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                    {trades.length}
                  </span>
                </div>
              </div>

              {trades.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-2">
                  <Zap size={22} style={{ color: '#333' }} />
                  <span className="text-xs font-mono" style={{ color: '#444' }}>
                    Completed trades will appear here
                  </span>
                </div>
              ) : (
                <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {['Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', 'Exit Reason'].map(h => (
                          <th key={h}
                            className="pb-2 text-left text-xs font-mono"
                            style={{ color: '#444', fontWeight: 500 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map(t => {
                        const pnlColor = (t.pnl ?? 0) >= 0 ? '#00e676' : '#ff4757';
                        const reasonColor =
                          t.reason === 'STOP_LOSS'   ? 'rgba(255,71,87,0.12)' :
                          t.reason === 'TAKE_PROFIT' ? 'rgba(0,230,118,0.12)' :
                                                       'rgba(255,255,255,0.04)';
                        return (
                          <tr key={t.id}
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                            <td className="py-2 text-xs font-mono font-bold"
                              style={{ color: 'var(--text-primary)' }}>{t.symbol}</td>
                            <td className="py-2 text-xs font-mono font-semibold"
                              style={{ color: t.side === 'BUY' ? '#00e676' : '#ff4757' }}>
                              {t.side}
                            </td>
                            <td className="py-2 text-xs font-mono" style={{ color: '#666' }}>
                              {t.qty}
                            </td>
                            <td className="py-2 text-xs font-mono" style={{ color: '#666' }}>
                              ₹{t.entryPrice?.toLocaleString('en-IN') || '—'}
                            </td>
                            <td className="py-2 text-xs font-mono" style={{ color: '#666' }}>
                              ₹{t.price?.toLocaleString('en-IN')}
                            </td>
                            <td className="py-2 text-xs font-mono font-semibold"
                              style={{ color: pnlColor }}>
                              {t.pnl != null
                                ? `${t.pnl >= 0 ? '+' : ''}₹${Math.abs(t.pnl).toFixed(0)}`
                                : '—'}
                            </td>
                            <td className="py-2">
                              <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                                style={{ background: reasonColor, color: '#888' }}>
                                {t.reason || 'SIGNAL'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
