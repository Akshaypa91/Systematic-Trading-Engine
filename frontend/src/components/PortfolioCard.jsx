// src/components/PortfolioCard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Portfolio state display: capital, positions, trade history.
// Includes Reset button → POST /api/sim/reset
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, RefreshCw,
  BarChart2, Loader2, Package, RotateCcw, AlertTriangle
} from 'lucide-react';
import { simAPI } from '../services/api';

// ── Stat tile ─────────────────────────────────────────────────────────────────
function Tile({ label, value, color, sub }) {
  return (
    <div style={{
      padding: '10px 12px', background: 'var(--bg-base)',
      border: '1px solid var(--border)', borderRadius: 9,
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

// ── Position row ──────────────────────────────────────────────────────────────
function PositionRow({ symbol, pos }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--bg-base)', border: '1px solid var(--border)',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-bright)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--cyan)',
          boxShadow: '0 0 6px rgba(0,212,255,0.4)',
        }} />
        <div>
          <div className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
            {symbol}
          </div>
          <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
            {pos.qty} shares · avg ₹{Number(pos.entryPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>
      <div className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>
        ₹{Number(pos.qty * pos.entryPrice).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 400 }}>cost basis</div>
      </div>
    </div>
  );
}

// ── Trade row ─────────────────────────────────────────────────────────────────
function TradeRow({ trade }) {
  const isBuy = trade.action === 'BUY';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 10px', borderRadius: 7,
      borderBottom: '1px solid var(--border)',
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
          ₹{Number(trade.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
      animation: 'fadeIn 0.15s ease-out',
    }}>
      <div className="card" style={{
        padding: 28, maxWidth: 360, width: '90%',
        animation: 'fadeUp 0.2s ease-out',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,176,32,0.10)',
            border: '1px solid rgba(255,176,32,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Reset Portfolio?
            </div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              This cannot be undone
            </div>
          </div>
        </div>

        <p className="font-mono" style={{
          fontSize: 11, color: 'var(--text-secondary)',
          lineHeight: 1.7, marginBottom: 20,
        }}>
          All open positions and trade history will be cleared.
          Capital will be restored to{' '}
          <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>
            ₹{Number(initialCapital).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: 'center', padding: '9px 0' }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
              padding: '9px 0', borderRadius: 8, border: '1px solid rgba(255,176,32,0.30)',
              background: 'rgba(255,176,32,0.10)', cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
              color: 'var(--amber)', transition: 'all 0.15s',
            }}>
            {busy
              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <RotateCcw size={12} />
            }
            {busy ? 'Resetting…' : 'Reset'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PortfolioCard({ refreshTrigger, onReset }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [resetBusy,   setResetBusy]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tab,         setTab]         = useState('positions');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await simAPI.getPortfolio();
      setData(res.data?.data ?? res.data ?? null);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  async function handleReset() {
    setResetBusy(true);
    try {
      const res = await simAPI.reset();
      const portfolio = res.data?.portfolio ?? null;
      setData(portfolio);
      setShowConfirm(false);
      if (onReset) onReset(portfolio);
    } catch (err) {
      console.error('Reset failed:', err.response?.data?.error || err.message);
    } finally {
      setResetBusy(false);
    }
  }

  const positions    = data?.positions ?? {};
  const trades       = data?.trades    ?? [];
  const capital      = data?.capital   ?? null;
  const initCapital  = data?.initialCapital ?? null;
  const posCount     = Object.keys(positions).length;
  const invested     = Object.values(positions).reduce((s, p) => s + p.qty * p.entryPrice, 0);
  const recentTrades = [...trades].reverse().slice(0, 15);
  const totalPnL     = trades.filter(t => t.action === 'SELL' && t.pnl != null)
    .reduce((s, t) => s + t.pnl, 0);

  const pnlPositive = totalPnL >= 0;

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
          padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(0,212,255,0.08)',
              border: '1px solid rgba(0,212,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Wallet size={14} style={{ color: 'var(--cyan)' }} />
            </div>
            <div>
              <div className="section-label" style={{ marginBottom: 1 }}>Portfolio</div>
              {initCapital && (
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  Started at ₹{Number(initCapital).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {/* Reset */}
            <button
              onClick={() => setShowConfirm(true)}
              disabled={loading || resetBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,176,32,0.22)',
                background: 'rgba(255,176,32,0.06)', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                color: 'var(--amber)', transition: 'all 0.15s',
                opacity: loading || resetBusy ? 0.5 : 1,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,176,32,0.45)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,176,32,0.22)'}>
              <RotateCcw size={10} />Reset
            </button>

            {/* Refresh */}
            <button onClick={load} disabled={loading} className="btn btn-ghost"
              style={{ padding: '5px 9px', fontSize: 10 }}>
              {loading
                ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                : <RefreshCw size={10} />
              }
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Tile
              label="Available"
              value={capital != null
                ? `₹${Number(capital).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                : null}
              color="var(--cyan)"
            />
            <Tile
              label="Invested"
              value={`₹${Number(invested).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
              color="var(--text-primary)"
              sub={`${posCount} position${posCount !== 1 ? 's' : ''}`}
            />
            <Tile
              label="Realised P&L"
              value={trades.length
                ? `${pnlPositive ? '+' : ''}₹${Math.abs(totalPnL).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                : '₹0'}
              color={totalPnL > 0 ? 'var(--green)' : totalPnL < 0 ? 'var(--red)' : 'var(--text-muted)'}
            />
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex', gap: 2, padding: 3,
            background: 'var(--bg-base)', borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            {[
              ['positions', BarChart2,   `Positions (${posCount})`],
              ['trades',    TrendingUp,  `History (${trades.length})`],
            ].map(([key, Icon, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 5,
                padding: '6px 0', borderRadius: 6, border: 'none',
                cursor: 'pointer', fontFamily: 'var(--font-mono)',
                fontSize: 10, fontWeight: 600, transition: 'all 0.15s',
                background: tab === key ? 'var(--bg-elevated)' : 'none',
                color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>
                <Icon size={10} />{label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80 }}>
            {loading && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0',
              }}>
                <Loader2 size={16} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
              </div>
            )}

            {!loading && tab === 'positions' && (
              posCount === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '24px 0', gap: 8,
                }}>
                  <Package size={18} style={{ color: 'var(--text-dim)' }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    No open positions
                  </p>
                </div>
              ) : (
                Object.entries(positions).map(([sym, pos]) => (
                  <PositionRow key={sym} symbol={sym} pos={pos} />
                ))
              )
            )}

            {!loading && tab === 'trades' && (
              recentTrades.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '24px 0', gap: 8,
                }}>
                  <TrendingDown size={18} style={{ color: 'var(--text-dim)' }} />
                  <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    No trades yet
                  </p>
                </div>
              ) : (
                recentTrades.map((t, i) => <TradeRow key={i} trade={t} />)
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}