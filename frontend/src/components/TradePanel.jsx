import { useState } from 'react';
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Loader2, Hash } from 'lucide-react';

function Result({ data, onDismiss }) {
  if (!data) return null;
  const ok = data.type === 'success';
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10,
      background: ok ? 'rgba(0,229,160,0.07)' : 'rgba(255,77,106,0.07)',
      border: `1px solid ${ok ? 'rgba(0,229,160,0.25)' : 'rgba(255,77,106,0.25)'}`,
      animation: 'fadeUp 0.2s ease-out',
    }}>
      {ok
        ? <CheckCircle2 size={14} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
        : <AlertCircle  size={14} style={{ color: 'var(--red)',   flexShrink: 0, marginTop: 1 }} />
      }
      <div style={{ flex: 1 }}>
        <p className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: ok ? 'var(--green)' : 'var(--red)', marginBottom: 2 }}>
          {ok ? 'Order Placed' : 'Order Failed'}
        </p>
        <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{data.message}</p>
      </div>
      <button onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>
        ×
      </button>
    </div>
  );
}

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

  async function execute() {
    if (!canTrade) return;
    setBusy(true); setResult(null);
    try {
      const res = await onTrade({ symbol, action: side, qty: qtyNum });
      const order = res?.data?.order ?? res?.data ?? {};
      setResult({ type: 'success', message: `${side} ${qtyNum} × ${symbol}${order.orderId ? ` · #${order.orderId}` : ''}` });
      setQty('');
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.error || err.message || 'Trade failed' });
    } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="section-label" style={{ marginBottom: 3 }}>Manual Trade</div>
          <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: symbol ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {symbol || 'No stock selected'}
          </span>
        </div>
        {currentPrice != null && (
          <div style={{ textAlign: 'right' }}>
            <div className="section-label" style={{ marginBottom: 2 }}>LTP</div>
            <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>
              ₹{Number(currentPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>

      {/* BUY / SELL toggle */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3,
        padding: 3, background: 'var(--bg-base)',
        borderRadius: 8, border: '1px solid var(--border)',
      }}>
        {['BUY', 'SELL'].map(s => {
          const active = side === s;
          const color  = s === 'BUY' ? 'var(--green)' : 'var(--red)';
          return (
            <button key={s} onClick={() => setSide(s)} style={{
              padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
              transition: 'all 0.15s',
              background: active ? (s === 'BUY' ? 'rgba(0,229,160,0.12)' : 'rgba(255,77,106,0.12)') : 'none',
              color: active ? color : 'var(--text-muted)',
            }}>{s}</button>
          );
        })}
      </div>

      {/* Quantity */}
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 6 }}>Quantity</label>
        <div style={{ position: 'relative' }}>
          <Hash size={12} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input type="number" min="1" step="1"
            value={qty}
            onChange={e => setQty(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter shares"
            disabled={!symbol || disabled}
            className="input" style={{ paddingLeft: 30 }}
          />
        </div>
        {/* Quick chips */}
        <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          {[1, 5, 10, 25, 50, 100].map(n => (
            <button key={n} type="button" onClick={() => setQty(String(n))}
              disabled={!symbol || disabled}
              className="font-mono" style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                transition: 'all 0.12s',
                background: qty === String(n) ? 'rgba(0,212,255,0.12)' : 'var(--bg-elevated)',
                border: `1px solid ${qty === String(n) ? 'rgba(0,212,255,0.3)' : 'var(--border)'}`,
                color:  qty === String(n) ? 'var(--cyan)' : 'var(--text-muted)',
                opacity: !symbol || disabled ? 0.4 : 1,
              }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Order preview */}
      {total != null && symbol && (
        <div style={{
          padding: '10px 14px', background: 'var(--bg-base)',
          border: `1px solid ${isBuy ? 'rgba(0,229,160,0.15)' : 'rgba(255,77,106,0.15)'}`,
          borderRadius: 8,
        }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Order Preview</div>
          {[
            ['Symbol', symbol],
            ['Action', side, isBuy ? 'var(--green)' : 'var(--red)'],
            ['Qty',    `${qtyNum} shares`],
            ['Price',  `₹${Number(currentPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
            ['Est. Value', `₹${Number(total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, 'var(--cyan)'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
              <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: color || 'var(--text-primary)' }}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Execute button */}
      <button onClick={execute} disabled={!canTrade}
        className={isBuy ? 'btn btn-green' : 'btn btn-red'}
        style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 13 }}>
        {busy
          ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />Processing…</>
          : isBuy
            ? <><TrendingUp  size={14} />BUY {validQty ? `${qtyNum} × ` : ''}{symbol || '—'}</>
            : <><TrendingDown size={14} />SELL {validQty ? `${qtyNum} × ` : ''}{symbol || '—'}</>
        }
      </button>

      {!symbol && (
        <p className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: -8 }}>
          Search a stock above to enable trading
        </p>
      )}

      <Result data={result} onDismiss={() => setResult(null)} />
    </div>
  );
}