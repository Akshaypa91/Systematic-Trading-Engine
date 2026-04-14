// src/components/PortfolioCard.jsx
import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, RefreshCw,
  BarChart2, Loader2, Package
} from 'lucide-react';
import { simAPI } from '../services/api';

/* ── Stat tile ───────────────────────────────────────────────────────────── */
function Tile({ label, value, color, sub }) {
  return (
    <div style={{
      padding: '10px 12px', background: 'var(--bg-base)',
      border: '1px solid var(--border)', borderRadius: 9,
    }}>
      <div className="section-label" style={{ marginBottom: 5 }}>{label}</div>
      <div className="font-mono" style={{
        fontSize: 14, fontWeight: 700, color: color || 'var(--text-primary)',
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

/* ── Position row ────────────────────────────────────────────────────────── */
function PositionRow({ symbol, pos, currentPrice }) {
  const pnl      = currentPrice != null
    ? ((currentPrice - pos.entryPrice) * pos.qty)
    : null;
  const pnlPct   = pnl != null
    ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
    : null;
  const positive = pnl == null || pnl >= 0;

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
          background: positive ? 'var(--green)' : 'var(--red)',
          boxShadow: `0 0 6px ${positive ? 'rgba(0,229,160,0.5)' : 'rgba(255,77,106,0.5)'}`,
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
      <div style={{ textAlign: 'right' }}>
        {currentPrice != null && (
          <div className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            ₹{Number(currentPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        )}
        {pnl != null && (
          <div className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: positive ? 'var(--green)' : 'var(--red)' }}>
            {positive ? '+' : ''}₹{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            {pnlPct != null && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>
                ({positive ? '+' : ''}{pnlPct.toFixed(2)}%)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Trade row ───────────────────────────────────────────────────────────── */
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
            fontSize: 10,
            color: trade.pnl >= 0 ? 'var(--green)' : 'var(--red)',
          }}>
            {trade.pnl >= 0 ? '+' : ''}₹{Math.abs(trade.pnl).toFixed(0)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function PortfolioCard({ refreshTrigger }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab,     setTab]     = useState('positions'); // 'positions' | 'trades'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await simAPI.getPortfolio();
      setData(res.data?.data ?? res.data ?? null);
    } catch {
      // silently fail — portfolio may not exist yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const positions    = data?.positions ?? {};
  const trades       = data?.trades    ?? [];
  const capital      = data?.capital   ?? null;
  const posCount     = Object.keys(positions).length;
  const invested     = Object.values(positions).reduce((s, p) => s + p.qty * p.entryPrice, 0);
  const recentTrades = [...trades].reverse().slice(0, 10);
  const totalPnL     = trades.filter(t => t.action === 'SELL' && t.pnl != null)
    .reduce((s, t) => s + t.pnl, 0);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '16px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Wallet size={14} style={{ color: 'var(--cyan)' }} />
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 1 }}>Portfolio</div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              in-memory · manual trades
            </div>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="btn btn-ghost"
          style={{ padding: '4px 8px', fontSize: 10 }}>
          {loading
            ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
            : <RefreshCw size={10} />
          }
          Refresh
        </button>
      </div>

      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Stats tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Tile
            label="Available Capital"
            value={capital != null ? `₹${Number(capital).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : null}
            color="var(--cyan)"
          />
          <Tile
            label="Invested"
            value={invested > 0 ? `₹${Number(invested).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '₹0'}
            color="var(--text-primary)"
            sub={`${posCount} position${posCount !== 1 ? 's' : ''}`}
          />
          <Tile
            label="Realised P&L"
            value={totalPnL !== 0
              ? `${totalPnL >= 0 ? '+' : ''}₹${Math.abs(totalPnL).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
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
          {[['positions', BarChart2, `Positions (${posCount})`], ['trades', TrendingUp, `History (${trades.length})`]].map(([key, Icon, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
              transition: 'all 0.15s',
              background: tab === key ? 'var(--bg-elevated)' : 'none',
              color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>
              <Icon size={10} />{label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80 }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
              <Loader2 size={16} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
            </div>
          )}

          {!loading && tab === 'positions' && (
            posCount === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '24px 0', gap: 8,
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
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '24px 0', gap: 8,
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
  );
}