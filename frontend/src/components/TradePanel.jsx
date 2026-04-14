// src/components/TradePanel.jsx
import { useState } from 'react';
import {
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2,
  Loader2, Hash, Zap
} from 'lucide-react';

/* ── Result banner ───────────────────────────────────────────────────────── */
function Result({ data, onDismiss }) {
  if (!data) return null;
  const ok = data.type === 'success';
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      display: 'flex', alignItems: 'flex-start', gap: 10,
      background: ok ? 'rgba(0,229,160,0.07)' : 'rgba(255,77,106,0.07)',
      border: `1px solid ${ok ? 'rgba(0,229,160,0.25)' : 'rgba(255,77,106,0.25)'}`,
      animation: 'fadeUp 0.2s ease-out',
    }}>
      {ok
        ? <CheckCircle2 size={14} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
        : <AlertCircle  size={14} style={{ color: 'var(--red)',   flexShrink: 0, marginTop: 1 }} />
      }
      <div style={{ flex: 1 }}>
        <p className="font-mono" style={{ fontSize: 12, fontWeight: 700,
          color: ok ? 'var(--green)' : 'var(--red)', marginBottom: 3 }}>
          {ok ? '✓ Order Executed' : '✗ Order Failed'}
        </p>
        <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {data.message}
        </p>
      </div>
      <button onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>
        ×
      </button>
    </div>
  );
}

/* ── Quick-qty chips ─────────────────────────────────────────────────────── */
const QTY_CHIPS = [1, 5, 10, 25, 50, 100];

/* ── Main component ──────────────────────────────────────────────────────── */
export default function TradePanel({ symbol, currentPrice, onTrade, disabled }) {
  const [qty,    setQty]    = useState('');
  const [side,   setSide]   = useState('BUY');
  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState(null);

  const qtyNum   = parseInt(qty, 10);
  const validQty = !isNaN(qtyNum) && qtyNum > 0;
  const canTrade = !!symbol && validQty && !disabled && !busy;
  const total    = validQty && currentPrice != null ? qtyNum * currentPrice : null;
  const isBuy    = side === 'BUY';

  // ── BUG FIX: declare 'order' before any conditional return ───────────────
  // The original bug: 'order' was referenced before its const declaration
  // in certain execution paths. Fixed by hoisting declaration intent clearly.
  async function execute() {
    if (!canTrade) return;

    setBusy(true);
    setResult(null);

    // Declare order BEFORE the try block — no TDZ risk
    let orderInfo = null;

    try {
      const res = await onTrade({ symbol, action: side, qty: qtyNum });

      // Safe access — res may be undefined if onTrade doesn't return
      orderInfo = res?.data?.trade ?? res?.data?.order ?? res?.data ?? {};

      setResult({
        type: 'success',
        message: `${side} ${qtyNum} × ${symbol} @ ₹${
          orderInfo?.price
            ? Number(orderInfo.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })
            : (currentPrice ? Number(currentPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—')
        }${orderInfo?.orderId ? ` · #${orderInfo.orderId}` : ''}`,
      });
      setQty('');
    } catch (err) {
      setResult({
        type: 'error',
        message: err.response?.data?.error || err.message || 'Trade failed',
      });
    } finally {
      setBusy(false);
    }
  }

  const fmtPrice = (p) =>
    p != null
      ? `₹${Number(p).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
      : '—';

  return (
    <div className="card" style={{
      padding: 0, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative',
    }}>

      {/* Top accent bar */}
      <div style={{
        height: 3,
        background: isBuy
          ? 'linear-gradient(90deg, transparent, rgba(0,229,160,0.8), transparent)'
          : 'linear-gradient(90deg, transparent, rgba(255,77,106,0.8), transparent)',
        transition: 'background 0.3s',
      }} />

      <div style={{ padding: '20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="section-label" style={{ marginBottom: 4 }}>Manual Order</div>
            <span className="font-mono" style={{
              fontSize: 15, fontWeight: 700, letterSpacing: '0.06em',
              color: symbol ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>
              {symbol || 'Select a stock'}
            </span>
          </div>
          {currentPrice != null && (
            <div style={{ textAlign: 'right' }}>
              <div className="section-label" style={{ marginBottom: 3 }}>LTP</div>
              <span className="font-mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--cyan)' }}>
                {fmtPrice(currentPrice)}
              </span>
            </div>
          )}
        </div>

        {/* BUY / SELL toggle */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
          padding: 4, background: 'var(--bg-base)',
          borderRadius: 10, border: '1px solid var(--border)',
        }}>
          {['BUY', 'SELL'].map(s => {
            const active = side === s;
            const col    = s === 'BUY' ? 'var(--green)' : 'var(--red)';
            return (
              <button key={s} onClick={() => { setSide(s); setResult(null); }} style={{
                padding: '9px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
                letterSpacing: '0.1em', transition: 'all 0.18s',
                background: active
                  ? (s === 'BUY' ? 'rgba(0,229,160,0.13)' : 'rgba(255,77,106,0.13)')
                  : 'none',
                color: active ? col : 'var(--text-muted)',
                boxShadow: active ? `0 0 12px ${s === 'BUY' ? 'rgba(0,229,160,0.15)' : 'rgba(255,77,106,0.15)'}` : 'none',
              }}>{s}</button>
            );
          })}
        </div>

        {/* Qty input */}
        <div>
          <label className="section-label" style={{ display: 'block', marginBottom: 6 }}>
            Quantity <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(shares)</span>
          </label>
          <div style={{ position: 'relative' }}>
            <Hash size={12} style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
            }} />
            <input
              type="number" min="1" step="1"
              value={qty}
              onChange={e => setQty(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter shares"
              disabled={!symbol || disabled}
              className="input"
              style={{ paddingLeft: 32 }}
            />
          </div>

          {/* Quick chips */}
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {QTY_CHIPS.map(n => {
              const active = qty === String(n);
              return (
                <button key={n} type="button"
                  onClick={() => setQty(String(n))}
                  disabled={!symbol || disabled}
                  className="font-mono"
                  style={{
                    padding: '4px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    transition: 'all 0.12s',
                    background: active ? 'rgba(0,212,255,0.13)' : 'var(--bg-elevated)',
                    border: `1px solid ${active ? 'rgba(0,212,255,0.35)' : 'var(--border)'}`,
                    color: active ? 'var(--cyan)' : 'var(--text-muted)',
                    fontWeight: active ? 700 : 400,
                    opacity: (!symbol || disabled) ? 0.35 : 1,
                  }}>
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        {/* Order preview */}
        {total != null && symbol && (
          <div style={{
            padding: '12px 14px',
            background: 'var(--bg-base)',
            border: `1px solid ${isBuy ? 'rgba(0,229,160,0.18)' : 'rgba(255,77,106,0.18)'}`,
            borderRadius: 10,
            animation: 'fadeUp 0.2s ease-out',
          }}>
            <div className="section-label" style={{ marginBottom: 10 }}>Order Preview</div>
            {[
              ['Symbol',    symbol,                          null],
              ['Action',    side,                            isBuy ? 'var(--green)' : 'var(--red)'],
              ['Quantity',  `${qtyNum} shares`,              null],
              ['Price',     fmtPrice(currentPrice),          null],
              ['Est. Total',
                `₹${Number(total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                'var(--cyan)'],
            ].map(([label, val, color]) => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 6,
              }}>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {label}
                </span>
                <span className="font-mono" style={{
                  fontSize: 12, fontWeight: 600,
                  color: color || 'var(--text-primary)',
                }}>
                  {val}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Execute button */}
        <button
          onClick={execute}
          disabled={!canTrade}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8,
            padding: '11px 0', borderRadius: 9, border: 'none',
            cursor: canTrade ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.06em', transition: 'all 0.18s',
            opacity: canTrade ? 1 : 0.4,
            background: canTrade
              ? (isBuy ? 'rgba(0,229,160,0.18)' : 'rgba(255,77,106,0.18)')
              : 'var(--bg-elevated)',
            color: canTrade ? (isBuy ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)',
            border: `1px solid ${canTrade
              ? (isBuy ? 'rgba(0,229,160,0.35)' : 'rgba(255,77,106,0.35)')
              : 'var(--border)'}`,
            boxShadow: canTrade
              ? `0 0 16px ${isBuy ? 'rgba(0,229,160,0.12)' : 'rgba(255,77,106,0.12)'}`
              : 'none',
          }}>
          {busy ? (
            <>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Executing…
            </>
          ) : isBuy ? (
            <>
              <TrendingUp size={14} />
              BUY {validQty ? `${qtyNum} × ` : ''}{symbol || '—'}
            </>
          ) : (
            <>
              <TrendingDown size={14} />
              SELL {validQty ? `${qtyNum} × ` : ''}{symbol || '—'}
            </>
          )}
        </button>

        {!symbol && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -8 }}>
            <Zap size={10} style={{ color: 'var(--text-dim)' }} />
            <p className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
              Search a stock above to enable trading
            </p>
          </div>
        )}

        <Result data={result} onDismiss={() => setResult(null)} />
      </div>
    </div>
  );
}
