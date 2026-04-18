// src/components/PortfolioCard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Portfolio display — safe against null/string/undefined numeric values.
// Every numeric display goes through n() which coerces to finite number.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, RefreshCw,
  BarChart2, Loader2, Package, RotateCcw, AlertTriangle,
  Activity, XCircle, AlertCircle,
} from 'lucide-react';
import { simAPI } from '../services/api';
import PositionsTable from './PositionsTable';

// ── Safe numeric helpers ──────────────────────────────────────────────────────
// n()  → always returns a finite JS number (never NaN, never string)
// fmt  → locale-formatted string
// fmtSign → signed ₹ string

const n = (v, fallback = 0) => {
  const parsed = parseFloat(v);
  return isFinite(parsed) ? parsed : fallback;
};

const fmt = (v, dec = 0) =>
  n(v).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

const fmtSign = (v, dec = 0) => {
  const num = n(v);
  return `${num >= 0 ? '+' : '−'}₹${fmt(Math.abs(num), dec)}`;
};

const pnlColor = (v) =>
  n(v) > 0 ? 'var(--green)' : n(v) < 0 ? 'var(--red)' : 'var(--text-muted)';

// ── Sub-components ────────────────────────────────────────────────────────────

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

function PnLTile({ label, value, pct }) {
  const num    = n(value);
  const pos    = num > 0;
  const neg    = num < 0;
  const color  = pnlColor(num);
  const bg     = pos ? 'rgba(0,229,160,0.06)' : neg ? 'rgba(255,77,106,0.06)' : 'var(--bg-base)';
  const border = pos ? 'rgba(0,229,160,0.18)' : neg ? 'rgba(255,77,106,0.18)' : 'var(--border)';
  const Icon   = pos ? TrendingUp : neg ? TrendingDown : Activity;

  return (
    <div style={{ padding: '10px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 9 }}>
      <div className="section-label" style={{ marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={11} style={{ color, flexShrink: 0 }} />
        <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1 }}>
          {fmtSign(num)}
        </div>
      </div>
      {pct !== undefined && pct !== null && (
        <div className="font-mono" style={{ fontSize: 10, color, marginTop: 3, opacity: 0.8 }}>
          {n(pct) >= 0 ? '+' : ''}{fmt(pct, 2)}% return
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }) {
  const isBuy = trade.action === 'BUY';
  const price = n(trade.price);
  const pnl   = trade.pnl !== null && trade.pnl !== undefined ? n(trade.pnl) : null;

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
          ₹{fmt(price, 2)}
        </div>
        {pnl !== null && trade.action === 'SELL' && (
          <div className="font-mono" style={{
            fontSize: 10, fontWeight: 600,
            color: pnl >= 0 ? 'var(--green)' : 'var(--red)',
          }}>
            {pnl >= 0 ? '+' : '−'}₹{fmt(Math.abs(pnl), 0)}
          </div>
        )}
      </div>
    </div>
  );
}

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
          All positions and trade history cleared.
          Capital restored to{' '}
          <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>₹{fmt(n(initialCapital))}</span>.
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
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
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
  const [error,       setError]       = useState(null);
  const [resetBusy,   setResetBusy]   = useState(false);
  const [exitBusy,    setExitBusy]    = useState(false);
  const [exitResult,  setExitResult]  = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tab,         setTab]         = useState('positions');
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await simAPI.getPortfolio();
      // Defensive: handle both { data } and { data: { data } } shapes
      const payload = res.data?.data ?? res.data ?? null;
      setData(payload);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to load portfolio';
      setError(msg);
      console.error('[PortfolioCard] load error:', msg);
    } finally {
      setLoading(false);
    }
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
      const port = res.data?.portfolio ?? res.data?.data ?? null;
      setData(port);
      setShowConfirm(false);
      setError(null);
      if (onReset) onReset(port);
    } catch (err) {
      console.error('Reset failed:', err.response?.data?.error || err.message);
    } finally { setResetBusy(false); }
  }

  async function handleExitAll() {
    setExitBusy(true);
    setExitResult(null);
    try {
      const res = await simAPI.exitAll();
      const d   = res.data;
      setData(d.portfolio ?? null);
      setExitResult({
        pnl:   n(d.realizedPnL),
        count: d.closedCount ?? 0,
      });
      setTimeout(() => setExitResult(null), 5000);
      if (onReset) onReset(d.portfolio);
    } catch (err) {
      console.error('Exit all failed:', err.response?.data?.error || err.message);
    } finally { setExitBusy(false); }
  }

  // ── Safe derived values — all coerced through n() ─────────────────────────
  const positions      = data?.positions      ?? {};
  const trades         = Array.isArray(data?.trades) ? data.trades : [];
  const capital        = n(data?.capital);
  const initCapital    = n(data?.initialCapital);
  const totalValue     = n(data?.totalValue);
  const unrealizedPnL  = n(data?.unrealizedPnL);
  const realizedPnL    = n(data?.realizedPnL);
  const totalPnL       = n(data?.totalPnL);
  const totalPnLPct    = n(data?.totalPnLPct);
  const positionsValue = n(data?.positionsValue);
  const biggestGainer  = data?.biggestGainer ?? null;
  const biggestLoser   = data?.biggestLoser  ?? null;
  const posCount       = Object.keys(positions).length;
  const recentTrades   = [...trades].reverse().slice(0, 15);
  const isInitialized  = data?.initialized ?? false;

  return (
    <>
      {showConfirm && (
        <ResetModal
          initialCapital={initCapital || capital}
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
              {initCapital > 0 && (
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Started ₹{fmt(initCapital)}
                  {posCount > 0 && <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>· live PnL</span>}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {posCount > 0 && (
              <button
                onClick={handleExitAll}
                disabled={exitBusy || loading}
                title="Close all open positions at market price"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 7,
                  border: '1px solid rgba(255,77,106,0.30)',
                  background: 'rgba(255,77,106,0.08)',
                  cursor: exitBusy || loading ? 'wait' : 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                  color: 'var(--red)', opacity: exitBusy || loading ? 0.5 : 1,
                }}
              >
                {exitBusy ? <Loader2 size={10} className="animate-spin" /> : <XCircle size={10} />}
                {exitBusy ? 'Closing…' : 'Exit All'}
              </button>
            )}
            <button onClick={() => setShowConfirm(true)} disabled={loading || resetBusy} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,176,32,0.22)',
              background: 'rgba(255,176,32,0.06)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
              color: 'var(--amber)', opacity: loading || resetBusy ? 0.5 : 1,
            }}>
              <RotateCcw size={10} />Reset
            </button>
            <button onClick={load} disabled={loading} className="btn btn-ghost" style={{ padding: '5px 9px', fontSize: 10 }}>
              {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Error banner */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(255,77,106,0.06)', border: '1px solid rgba(255,77,106,0.20)',
            }}>
              <AlertCircle size={13} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--red)' }}>
                {error}
              </span>
              <button onClick={load} style={{
                marginLeft: 'auto', padding: '2px 8px', borderRadius: 5,
                border: '1px solid rgba(255,77,106,0.30)', background: 'transparent',
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--red)', cursor: 'pointer',
              }}>Retry</button>
            </div>
          )}

          {/* Not initialized prompt */}
          {!loading && !error && !isInitialized && (
            <div style={{
              padding: '16px', borderRadius: 9, textAlign: 'center',
              background: 'var(--bg-base)', border: '1px solid var(--border)',
            }}>
              <Package size={20} style={{ color: 'var(--text-dim)', margin: '0 auto 8px' }} />
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                No portfolio yet — set capital above to start
              </p>
            </div>
          )}

          {/* Stats — only when initialized */}
          {isInitialized && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <Tile label="💰 Capital"    value={`₹${fmt(capital)}`}        color="var(--cyan)" highlight />
                <Tile label="📊 Invested"   value={`₹${fmt(positionsValue)}`} color="var(--text-primary)"
                      sub={`${posCount} position${posCount !== 1 ? 's' : ''}`} />
                <Tile label="💎 Total Value" value={`₹${fmt(totalValue)}`}    color="var(--text-primary)"
                      sub={initCapital > 0 ? `of ₹${fmt(initCapital)} start` : undefined} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <PnLTile label="📈 Unrealized" value={unrealizedPnL} />
                <PnLTile label="✅ Realized"   value={realizedPnL} />
                <PnLTile label="🎯 Total PnL"  value={totalPnL} pct={totalPnLPct} />
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
                  posCount === 0
                    ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: 8 }}>
                        <Package size={18} style={{ color: 'var(--text-dim)' }} />
                        <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>No open positions</p>
                      </div>
                    )
                    : <PositionsTable positions={positions} biggestGainer={biggestGainer} biggestLoser={biggestLoser} />
                )}

                {!loading && tab === 'trades' && (
                  recentTrades.length === 0
                    ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: 8 }}>
                        <TrendingDown size={18} style={{ color: 'var(--text-dim)' }} />
                        <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>No trades yet</p>
                      </div>
                    )
                    : <div>{recentTrades.map((t, i) => <TradeRow key={i} trade={t} />)}</div>
                )}
              </div>

              {/* Exit result flash */}
              {exitResult && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, animation: 'fadeUp 0.2s ease-out',
                  background: n(exitResult.pnl) >= 0 ? 'rgba(0,229,160,0.08)' : 'rgba(255,77,106,0.08)',
                  border: `1px solid ${n(exitResult.pnl) >= 0 ? 'rgba(0,229,160,0.25)' : 'rgba(255,77,106,0.25)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    ✓ Closed {exitResult.count} position{exitResult.count !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono" style={{
                    fontSize: 12, fontWeight: 700,
                    color: n(exitResult.pnl) >= 0 ? 'var(--green)' : 'var(--red)',
                  }}>
                    {n(exitResult.pnl) >= 0 ? '+' : '−'}₹{fmt(Math.abs(n(exitResult.pnl)), 0)} PnL
                  </span>
                </div>
              )}

              {data?.pricesAt && posCount > 0 && (
                <div className="font-mono" style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'right' }}>
                  Prices at {new Date(data.pricesAt).toLocaleTimeString('en-IN')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
