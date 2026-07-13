import { useState, useEffect, useRef, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { useWS } from '../context/WSContext';
import { simAPI } from '../services/api';
import SignalCard from '../components/SignalCard';
import LiveEquityChart from '../components/LiveEquityChart';
import Toast from '../components/Toast';
import {
  DollarSign, TrendingUp, Activity, BarChart2,
  Play, Square, RefreshCw, Shield, Zap,
  Clock, AlertCircle, ArrowUpRight, ArrowDownRight
} from 'lucide-react';

// ── Safe number helpers ───────────────────────────────────────────────────────
const n   = (v, fallback = 0) => (isFinite(Number(v)) ? Number(v) : fallback);
const fmt = (v, dec = 0) => n(v).toLocaleString('en-IN', { maximumFractionDigits: dec, minimumFractionDigits: dec });
const pct = (v, dec = 2) => `${n(v) >= 0 ? '+' : ''}${n(v).toFixed(dec)}%`;

// ── Data source badge ─────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  const cfg = {
    LIVE_UPSTOX: { label: 'LIVE', dot: 'var(--green)',  bg: 'color-mix(in srgb, var(--green) 8%, transparent)' },
    LIVE_NSE:    { label: 'NSE',  dot: 'var(--amber)',  bg: 'color-mix(in srgb, var(--amber) 8%, transparent)' },
    SIM:         { label: 'SIM',  dot: 'var(--text-muted)', bg: 'var(--bg-elevated)' },
  }[source] || { label: source || 'SIM', dot: 'var(--text-muted)', bg: 'var(--bg-elevated)' };

  return (
    <span className="font-mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
      background: cfg.bg, color: cfg.dot,
      border: `1px solid color-mix(in srgb, ${cfg.dot} 20%, transparent)`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

// ── Portfolio stat card ───────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, Icon, delay = 0, loading = false }) {
  return (
    <div className="card fade-up" style={{ padding: 20, position: 'relative', overflow: 'hidden', animationDelay: `${delay}s` }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 80, height: 80, borderRadius: '50%',
        background: `radial-gradient(circle, color-mix(in srgb, ${color} 12%, transparent), transparent 70%)`, pointerEvents: 'none' }} />
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span className="section-label">{label}</span>
        {Icon && (
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${color} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={13} style={{ color }} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 26, borderRadius: 6 }} />
      ) : (
        <div className="num-flip" style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {value ?? '—'}
        </div>
      )}
      {sub && <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

// ── Signal mix bar ────────────────────────────────────────────────────────────
function SignalMixBar({ signals }) {
  const safe  = Array.isArray(signals) ? signals : [];
  const buy   = safe.filter(s => s?.signal === 'BUY').length;
  const sell  = safe.filter(s => s?.signal === 'SELL').length;
  const hold  = safe.length - buy - sell;
  const total = safe.length || 1;
  return (
    <div className="card" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
      <span className="section-label" style={{ flexShrink: 0 }}>Signal Mix</span>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--bg-elevated)', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${(buy / total) * 100}%`, background: 'var(--green)', transition: 'width 0.5s', height: '100%' }} />
        <div style={{ width: `${(sell / total) * 100}%`, background: 'var(--red)', transition: 'width 0.5s', height: '100%' }} />
        <div style={{ flex: 1, background: 'var(--amber)', height: '100%', opacity: 0.6 }} />
      </div>
      <div className="flex gap-4 font-mono" style={{ fontSize: 11, flexShrink: 0 }}>
        <span style={{ color: 'var(--green)' }}>▲ {buy}</span>
        <span style={{ color: 'var(--red)' }}>▼ {sell}</span>
        <span style={{ color: 'var(--amber)' }}>— {hold}</span>
      </div>
    </div>
  );
}

// ── Open position row ─────────────────────────────────────────────────────────
function PositionRow({ sym, pos }) {
  if (!pos) return null;
  const pnl    = n(pos.unrealizedPnl);
  const entry  = n(pos.entryPrice);
  const curr   = n(pos.currentPrice);
  const pnlPct = entry > 0 ? ((curr - entry) / entry * 100).toFixed(2) : '—';
  const green  = pnl >= 0;
  const Icon   = green ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="card-elevated trade-row" style={{ padding: '12px 14px', borderRadius: 10 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{sym}</span>
        <div className="flex items-center gap-1 font-mono" style={{ fontSize: 12, fontWeight: 600, color: green ? 'var(--green)' : 'var(--red)' }}>
          <Icon size={12} />
          {pnl >= 0 ? '+' : ''}₹{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          <span style={{ fontSize: 10, opacity: 0.7 }}>({pnlPct}%)</span>
        </div>
      </div>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        {pos.qty ?? 0} shares · Entry ₹{entry > 0 ? entry.toLocaleString('en-IN') : '—'} → ₹{curr > 0 ? curr.toLocaleString('en-IN') : '—'}
      </div>
      <div className="flex gap-3 font-mono" style={{ fontSize: 10, marginTop: 5 }}>
        <span style={{ color: 'color-mix(in srgb, var(--red) 70%, transparent)' }}>SL ₹{n(pos.stopLoss).toLocaleString('en-IN') || '—'}</span>
        <span style={{ color: 'color-mix(in srgb, var(--green) 70%, transparent)' }}>TP ₹{n(pos.takeProfit).toLocaleString('en-IN') || '—'}</span>
        {pos.source && <SourceBadge source={pos.source} />}
      </div>
    </div>
  );
}

// ── Paper trade row ───────────────────────────────────────────────────────────
function PaperTradeRow({ t, isNew }) {
  if (!t) return null;
  const pnl      = n(t.pnl);
  const green    = pnl >= 0;
  const reasonBg = t.reason === 'STOP_LOSS'   ? 'color-mix(in srgb, var(--red) 10%, transparent)'
                 : t.reason === 'TAKE_PROFIT' ? 'color-mix(in srgb, var(--green) 10%, transparent)'
                 :                              'var(--bg-elevated)';
  return (
    <tr className={`trade-row ${isNew ? 'trade-flash' : ''}`} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}>
      <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{t.symbol}</td>
      <td style={{ padding: '9px 12px' }}>
        <span className={`badge ${t.side === 'BUY' ? 'badge-buy' : 'badge-sell'}`} style={{ fontSize: 10 }}>{t.side}</span>
      </td>
      <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{t.qty ?? '—'}</td>
      <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
        ₹{n(t.entryPrice) > 0 ? n(t.entryPrice).toLocaleString('en-IN') : '—'}
      </td>
      <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
        ₹{n(t.price) > 0 ? n(t.price).toLocaleString('en-IN') : '—'}
      </td>
      <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: green ? 'var(--green)' : 'var(--red)' }}>
        {t.pnl != null ? `${green ? '+' : ''}₹${Math.abs(pnl).toFixed(0)}` : '—'}
      </td>
      <td style={{ padding: '9px 12px' }}>
        <span className="font-mono" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: reasonBg, color: 'var(--text-secondary)' }}>
          {t.reason || 'SIGNAL'}
        </span>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LiveTrading() {
  const { signals: wsSigs, portfolio: wsPort, trades: wsTrades, lastTick, newTrade, status } = useWS();

  const [equityData,  setEquityData]  = useState([]);
  const [localTrades, setLocalTrades] = useState([]);
  const [localPort,   setLocalPort]   = useState(null);
  const [running,     setRunning]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [portLoading, setPortLoading] = useState(true);
  const [filter,      setFilter]      = useState('ALL');
  const [toast,       setToast]       = useState(null);
  const [newTradeId,  setNewTradeId]  = useState(null);
  const [dataSource,  setDataSource]  = useState('SIM');

  const equityRef = useRef([]);
  const pollRef   = useRef(null);

  const showToast = (msg, type = 'info') => setToast({ msg, type });

  // WS data takes priority, fall back to REST
  const portfolio = wsPort || localPort;
  const trades    = (wsTrades?.length > 0 ? wsTrades : localTrades) ?? [];
  const signals   = Array.isArray(wsSigs) ? wsSigs : [];

  // Track dominant data source from signals
  useEffect(() => {
    if (!signals.length) return;
    const live = signals.filter(s => s?.source === 'LIVE').length;
    setDataSource(live > signals.length / 2 ? 'LIVE_UPSTOX' : 'SIM');
  }, [signals]);

  // Flash new trade
  useEffect(() => {
    if (!newTrade) return;
    setNewTradeId(newTrade.id);
    const t = setTimeout(() => setNewTradeId(null), 1200);
    return () => clearTimeout(t);
  }, [newTrade]);

  // REST fallback
  const fetchREST = useCallback(async () => {
    try {
      const [portRes, tradesRes, equityRes, statusRes] = await Promise.allSettled([
        simAPI.getPortfolio(),
        simAPI.getTrades(50),
        simAPI.getEquity(),
        simAPI.getStatus(),
      ]);

      if (portRes.status === 'fulfilled') {
        const d = portRes.value?.data?.data;
        if (d) setLocalPort(d);
      }
      if (tradesRes.status === 'fulfilled') {
        setLocalTrades(tradesRes.value?.data?.data ?? []);
      }
      if (equityRes.status === 'fulfilled') {
        const raw  = equityRes.value?.data?.data ?? [];
        const step = Math.max(1, Math.floor(raw.length / 150));
        const pts  = raw
          .filter((_, i) => i % step === 0 || i === raw.length - 1)
          .map(p => ({
            t:      new Date(p.t).toLocaleTimeString('en-IN', { hour12: false }),
            equity: parseFloat((n(p.equity) / 1000).toFixed(2)),
          }));
        equityRef.current = pts;
        setEquityData([...pts]);
      }
      if (statusRes.status === 'fulfilled') {
        setRunning(statusRes.value?.data?.engine?.running ?? false);
      }
    } catch (_) {
      // non-fatal
    } finally {
      setPortLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchREST();
  }, [fetchREST]);

  // Poll equity curve every 5s
  useEffect(() => {
    pollRef.current = setInterval(() => {
      simAPI.getEquity().then(r => {
        const raw  = r?.data?.data ?? [];
        const step = Math.max(1, Math.floor(raw.length / 150));
        const pts  = raw
          .filter((_, i) => i % step === 0 || i === raw.length - 1)
          .map(p => ({
            t:      new Date(p.t).toLocaleTimeString('en-IN', { hour12: false }),
            equity: parseFloat((n(p.equity) / 1000).toFixed(2)),
          }));
        setEquityData([...pts]);
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    if (status === 'connected') fetchREST();
  }, [status, fetchREST]);

  async function handleStart() {
    setLoading(true);
    try {
      await simAPI.startEngine({ intervalMs: 4000 });
      setRunning(true);
      showToast('Simulation engine started', 'success');
      fetchREST();
    } catch {
      showToast('Failed to start engine', 'error');
    }
    setLoading(false);
  }

  async function handleStop() {
    try {
      await simAPI.stopEngine();
      setRunning(false);
      showToast('Engine stopped', 'info');
    } catch {
      showToast('Failed to stop engine', 'error');
    }
  }

  // Safe portfolio values — handle BOTH the WS-normalised shape (equity,
  // totalReturn, openPnl, openPositions) and the REST /sim/portfolio shape
  // (totalValue, totalPnLPct, unrealizedPnL, positions). Missing keys caused
  // Total Return to read 0% and positions to show empty.
  const positionsObj   = portfolio?.openPositions ?? portfolio?.positions ?? {};
  const openPnl        = n(portfolio?.openPnl ?? portfolio?.unrealizedPnL);
  const initCap        = n(portfolio?.initialCapital, 1000000);
  const equity         = n(portfolio?.equity ?? portfolio?.totalValue ?? (portfolio?.capital != null ? portfolio.capital + openPnl : undefined) ?? portfolio?.capital);
  const totalReturn    = n(portfolio?.totalReturn ?? portfolio?.totalReturnPct ?? portfolio?.totalPnLPct
    ?? (initCap ? ((equity - initCap) / initCap) * 100 : 0));
  const totalPnl       = n(portfolio?.totalPnl ?? portfolio?.totalPnL);
  const openPosCount   = Object.keys(positionsObj).length;
  const retColor       = totalReturn >= 0 ? 'var(--green)' : 'var(--red)';

  const winTrades      = trades.filter(t => n(t?.pnl) > 0).length;
  const winRate        = trades.length ? ((winTrades / trades.length) * 100).toFixed(0) : null;
  const filteredSig    = filter === 'ALL' ? signals : signals.filter(s => s?.signal === filter);
  const openPositions  = Object.entries(positionsObj);

  return (
    <AppShell>
      <main className="page-content">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between ui-wrap" style={{ marginBottom: 24, gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Live Trading</h1>
            <div className="flex items-center gap-3">
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Simulation mode · paper trading</span>
              <SourceBadge source={dataSource} />
              {lastTick && (
                <span className="flex items-center gap-1 font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  <Clock size={9} /> {new Date(lastTick).toLocaleTimeString('en-IN', { hour12: false })}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2" style={{ padding: '6px 12px', borderRadius: 99,
              background: running ? 'color-mix(in srgb, var(--green) 7%, transparent)' : 'color-mix(in srgb, var(--red) 7%, transparent)',
              border: `1px solid ${running ? 'color-mix(in srgb, var(--green) 25%, transparent)' : 'color-mix(in srgb, var(--red) 25%, transparent)'}` }}>
              <span className={`live-dot ${running ? '' : 'stopped'}`} style={{ width: 6, height: 6 }} />
              <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: running ? 'var(--green)' : 'var(--red)' }}>
                {running ? 'LIVE' : 'STOPPED'}
              </span>
            </div>

            {!running ? (
              <button onClick={handleStart} disabled={loading} className="btn btn-green">
                {loading ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                Start Engine
              </button>
            ) : (
              <button onClick={handleStop} className="btn btn-red">
                <Square size={12} /> Stop
              </button>
            )}

            <button onClick={fetchREST} className="btn btn-ghost" style={{ padding: '7px 10px' }} title="Refresh">
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* ── Signal mix bar ─────────────────────────────────────────────── */}
        <SignalMixBar signals={signals} />

        {/* ── Stats row ──────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard label="Portfolio Equity" color="var(--cyan)" loading={portLoading}
            value={portfolio ? `₹${fmt(equity)}` : '—'}
            sub={portfolio ? `Initial ₹${(initCap / 1e5).toFixed(0)}L` : ''}
            Icon={DollarSign} delay={0} />
          <StatCard label="Total Return" color={portfolio ? retColor : 'var(--cyan)'} loading={portLoading}
            value={portfolio ? pct(totalReturn) : '—'}
            sub={portfolio ? `P&L ₹${fmt(totalPnl)}` : ''}
            Icon={TrendingUp} delay={0.05} />
          <StatCard label="Open Positions" color="var(--amber)" loading={portLoading}
            value={portfolio ? openPosCount : '—'}
            sub={portfolio ? `Open P&L ₹${fmt(openPnl)}` : ''}
            Icon={Activity} delay={0.10} />
          <StatCard label="Win Rate" color="var(--purple)"
            value={winRate != null ? `${winRate}%` : '—'}
            sub={`${winTrades}W / ${trades.length - winTrades}L of ${trades.length}`}
            Icon={BarChart2} delay={0.15} />
        </div>

        {/* ── Equity + Positions ─────────────────────────────────────────── */}
        <div className="dash-grid-2" style={{ gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 20 }}>
          <div className="card fade-up stagger-1" style={{ padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>Live Equity Curve</div>
                <p className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>Portfolio value in ₹K · paper simulation</p>
              </div>
              {equityData.length > 0 && (
                <span className="font-mono" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  {equityData.length} pts
                </span>
              )}
            </div>
            <LiveEquityChart data={equityData} initialCapital={initCap || 1000000} />
          </div>

          <div className="card fade-up stagger-2" style={{ padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2">
                <Shield size={13} style={{ color: 'var(--text-muted)' }} />
                <span className="section-label">Open Positions</span>
              </div>
              <span className="font-mono" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                {openPositions.length}
              </span>
            </div>

            {openPositions.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8 }}>
                <BarChart2 size={24} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>No open positions</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 280 }}>
                {openPositions.map(([sym, pos]) => <PositionRow key={sym} sym={sym} pos={pos} />)}
              </div>
            )}
          </div>
        </div>

        {/* ── Signals + Trades ───────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
          {/* Signals */}
          <div className="card fade-up stagger-3" style={{ padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2">
                <span className="live-dot" style={{ width: 6, height: 6 }} />
                <span className="section-label">Live Signals</span>
                <span className="font-mono" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  {filteredSig.length}
                </span>
              </div>
              <div className="flex gap-1">
                {['ALL', 'BUY', 'SELL', 'HOLD'].map(f => {
                  const fc = { ALL: 'var(--cyan)', BUY: 'var(--green)', SELL: 'var(--red)', HOLD: 'var(--amber)' }[f];
                  return (
                    <button key={f} onClick={() => setFilter(f)} className="font-mono"
                      aria-pressed={filter === f}
                      style={{ padding: '2px 8px', borderRadius: 5, fontSize: 9, fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${filter === f ? `color-mix(in srgb, ${fc} 33%, transparent)` : 'var(--border)'}`,
                        background: filter === f ? `color-mix(in srgb, ${fc} 7%, transparent)` : 'transparent',
                        color: filter === f ? fc : 'var(--text-muted)' }}>
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredSig.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 8 }}>
                <AlertCircle size={22} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {running ? 'Generating signals…' : 'Start the engine'}
                </p>
              </div>
            ) : (
              <div className="scroll-y" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8, overflowY: 'auto', maxHeight: 400 }}>
                {filteredSig.map(s => s && <SignalCard key={s.symbol} signal={s} />)}
              </div>
            )}
          </div>

          {/* Trades */}
          <div className="card fade-up stagger-4" style={{ padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2">
                <Activity size={13} style={{ color: 'var(--text-muted)' }} />
                <span className="section-label">Paper Trade History</span>
              </div>
              <div className="flex items-center gap-2 font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {trades.length > 0 && (
                  <><span style={{ color: 'var(--green)' }}>{winTrades}W</span>/<span style={{ color: 'var(--red)' }}>{trades.length - winTrades}L</span></>
                )}
                <span style={{ padding: '2px 8px', borderRadius: 5, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>{trades.length}</span>
              </div>
            </div>

            {trades.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 8 }}>
                <Zap size={22} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trades will appear here</p>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: 400 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', 'Reason'].map(h => (
                        <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(t => t && <PaperTradeRow key={t.id ?? Math.random()} t={t} isNew={t.id === newTradeId} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
