// src/components/PortfolioCard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Portfolio state display: capital · PnL · positions table · trade history.
// Now shows: unrealized PnL, realized PnL, total PnL, % return, total value.
// Auto-refreshes every 15s when positions are open.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, RefreshCw,
  BarChart2, Loader2, Package, RotateCcw, AlertTriangle, Activity,
} from 'lucide-react';
import { simAPI } from '../services/api';
import PositionsTable from './PositionsTable';

const fmt = (n, dec = 0) =>
  Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

const fmtSign = (n, dec = 0) =>
  `${n >= 0 ? '+' : '−'}₹${fmt(Math.abs(n), dec)}`;

const pnlColor = (v) =>
  v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text-muted)';

// ── Stat tile ─────────────────────────────────────────────────────────────────
function Tile({ label, value, color, sub, highlight }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: highlight ? 'rgba(0,212,255,0.05)' : 'var(--bg-base)',
      border: `1px solid ${highlight ? 'rgba(0,212,255,0.20)' : 'var(--border)'}`,
      borderRadius: 9,
    }}>
      <div className="section-label" style={{ marginBottom: 5 }}>{label}</div>
      <div className="font-mono" style={{
        fontSize: 13, fontWeight: 700,
        color: color || 'var(--text-primary)',
        lineHeight: 1, marginBottom: sub ? 4 : 0,
      }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── PnL Tile ──────────────────────────────────────────────────────────────────
function PnLTile({ label, value, pct }) {
  const pos    = value > 0;
  const neg    = value < 0;
  const color  = pnlColor(value);
  const bg     = pos ? 'rgba(0,229,160,0.06)' : neg ? 'rgba(255,77,106,0.06)' : 'var(--bg-base)';
  const border = pos ? 'rgba(0,229,160,0.18)' : neg ? 'rgba(255,77,106,0.18)' : 'var(--border)';
  const Icon   = pos ? TrendingUp : neg ? TrendingDown : Activity;

  return (
    <div style={{ padding: '10px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 9 }}>
      <div className="section-label" style={{ marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={11} style={{ color, flexShrink: 0 }} />
        <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1 }}>
          {fmtSign(value)}
        </div>
      </div>
      {pct !== undefined && pct !== null && (
        <div className="font-mono" style={{ fontSize: 10, color, marginTop: 3, opacity: 0.8 }}>
          {pct >= 0 ? '+' : ''}{fmt(pct, 2)}% return
        </div>
      )}
    </div>
  );
}

// ── Trade row ─────────────────────────────────────────────────────────────────
function TradeRow({ trade }) {
  const isBuy = trade.action === 'BUY';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 10px', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', padding: '2px 7px', borderRadius: 5,
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.08em',
          background: isBuy ? 'rgba(0,229,160,0.10)' : 'rgba(255,77,106,0.10)',
          border: `1px solid ${isBuy ? 'rgba(0,229,160,0.25)' : 'rgba(255,77,106,0.25)'}`,
          color: isBuy ? 'var(--green)' : 'var(--red)',
        }}>
          {trade.action}
        </span>
        <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
          {trade.symbol}
        </span>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          × {trade.qty}
        </span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          ₹{fmt(trade.price, 2)}
        </div>
        {trade.pnl != null && trade.action === 'SELL' && (
          <div className="font-mono" style={{
            fontSize: 10, fontWeight: 600,
            color: trade.pnl >= 0 ? 'var(--green)' : 'var(--red)',
          }}>
            {trade.pnl >= 0 ? '+' : ''}₹{Math.abs(trade.pnl).toFixed(0)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reset confirm modal ───────────────────────────────────────────────────────
function ResetModal({ initialCapital, onConfirm, onCancel, busy }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(6,10,18,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="card" style={{ padding: 28, maxWidth: 360, width: '90%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,176,32,0.10)', border: '1px solid rgba(255,176,32,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Reset Portfolio?</div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>This cannot be undone</div>
          </div>
        </div>
        <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
          All open positions and trade history will be cleared.
          Capital will be restored to{' '}
          <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>₹{fmt(initialCapital)}</span>.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '9px 0' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '9px 0', borderRadius: 8, border: '1px solid rgba(255,176,32,0.30)',
            background: 'rgba(255,176,32,0.10)', cursor: busy ? 'wait' : 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--amber)',
          }}>
            {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={12} />}
            {busy ? 'Resetting…' : 'Reset'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const AUTO_REFRESH_MS = 15_000;

export default function PortfolioCard({ refreshTrigger, onReset }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [resetBusy,   setResetBusy]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tab,         setTab]         = useState('positions');
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await simAPI.getPortfolio();
      setData(res.data?.data ?? res.data ?? null);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  // Auto-refresh when positions open
  useEffect(() => {
    const hasPositions = data && Object.keys(data.positions ?? {}).length > 0;
    clearInterval(timerRef.current);
    if (hasPositions) timerRef.current = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [data, load]);

  async function handleReset() {
    setResetBusy(true);
    try {
      const res  = await simAPI.reset();
      const port = res.data?.portfolio ?? null;
      setData(port);
      setShowConfirm(false);
      if (onReset) onReset(port);
    } catch (err) {
      console.error('Reset failed:', err.response?.data?.error || err.message);
    } finally { setResetBusy(false); }
  }

  // Derived
  const positions      = data?.positions      ?? {};
  const trades         = data?.trades         ?? [];
  const capital        = data?.capital        ?? null;
  const initCapital    = data?.initialCapital ?? null;
  const totalValue     = data?.totalValue     ?? null;
  const unrealizedPnL  = data?.unrealizedPnL  ?? 0;
  const realizedPnL    = data?.realizedPnL    ?? 0;
  const totalPnL       = data?.totalPnL       ?? 0;
  const totalPnLPct    = data?.totalPnLPct    ?? 0;
  const positionsValue = data?.positionsValue ?? 0;
  const biggestGainer  = data?.biggestGainer  ?? null;
  const biggestLoser   = data?.biggestLoser   ?? null;
  const posCount       = Object.keys(positions).length;
  const recentTrades   = [...trades].reverse().slice(0, 15);

  return (
    <>
      {showConfirm && (
        <ResetModal
          initialCapital={initCapital ?? capital}
          onConfirm={handleReset}
          onCancel={() => setShowConfirm(false)}
          busy={resetBusy}
        />
      )}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Wallet size={14} style={{ color: 'var(--cyan)' }} />
            </div>
            <div>
              <div className="section-label" style={{ marginBottom: 1 }}>Portfolio</div>
              {initCapital && (
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Started ₹{fmt(initCapital)}
                  {posCount > 0 && <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>· live PnL</span>}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowConfirm(true)} disabled={loading || resetBusy} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,176,32,0.22)',
              background: 'rgba(255,176,32,0.06)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
              color: 'var(--amber)', opacity: loading || resetBusy ? 0.5 : 1,
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,176,32,0.45)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,176,32,0.22)'}>
              <RotateCcw size={10} />Reset
            </button>
            <button onClick={load} disabled={loading} className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: 10 }}>
              {loading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={10} />}
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Row 1: Capital · Invested · Total Value */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Tile label="💰 Capital" value={capital != null ? `₹${fmt(capital)}` : null} color="var(--cyan)" highlight />
            <Tile label="📊 Invested" value={`₹${fmt(positionsValue)}`} color="var(--text-primary)" sub={`${posCount} position${posCount !== 1 ? 's' : ''}`} />
            <Tile label="💎 Total Value" value={totalValue != null ? `₹${fmt(totalValue)}` : null} color="var(--text-primary)" sub={initCapital ? `of ₹${fmt(initCapital)} start` : undefined} />
          </div>

          {/* Row 2: Unrealized · Realized · Total PnL */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <PnLTile label="📈 Unrealized" value={unrealizedPnL} />
            <PnLTile label="✅ Realized" value={realizedPnL} />
            <PnLTile label="🎯 Total PnL" value={totalPnL} pct={totalPnLPct} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)' }}>
            {[
              ['positions', BarChart2,  `Positions (${posCount})`],
              ['trades',    TrendingUp, `History (${trades.length})`],
            ].map(([key, Icon, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                background: tab === key ? 'var(--bg-elevated)' : 'none',
                color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>
                <Icon size={10} />{label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ minHeight: 80 }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                <Loader2 size={16} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
              </div>
            )}

            {!loading && tab === 'positions' && (
              posCount === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0', gap: 8 }}>
                  <Package size={18} style={{ color: 'var(--text-dim)' }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>No open positions</p>
                </div>
              ) : (
                <PositionsTable positions={positions} biggestGainer={biggestGainer} biggestLoser={biggestLoser} />
              )
            )}

            {!loading && tab === 'trades' && (
              recentTrades.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0', gap: 8 }}>
                  <TrendingDown size={18} style={{ color: 'var(--text-dim)' }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>No trades yet</p>
                </div>
              ) : (
                <div>{recentTrades.map((t, i) => <TradeRow key={i} trade={t} />)}</div>
              )
            )}
          </div>

          {/* Price timestamp */}
          {data?.pricesAt && posCount > 0 && (
            <div className="font-mono" style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'right' }}>
              Prices at {new Date(data.pricesAt).toLocaleTimeString('en-IN')}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
