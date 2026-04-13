import { useState } from 'react';
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Loader2, DollarSign, Hash } from 'lucide-react';

function TradeResult({ result, onDismiss }) {
  if (!result) return null;

  const isSuccess = result.type === 'success';

  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: 8,
      background: isSuccess ? 'rgba(0,229,160,0.08)' : 'rgba(255,77,106,0.08)',
      border: `1px solid ${isSuccess ? 'rgba(0,229,160,0.25)' : 'rgba(255,77,106,0.25)'}`,
      display: 'flex', alignItems: 'flex-start', gap: 10,
      animation: 'fadeUp 0.2s ease-out',
    }}>
      {isSuccess
        ? <CheckCircle2 size={15} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
        : <AlertCircle  size={15} style={{ color: 'var(--red)',   flexShrink: 0, marginTop: 1 }} />
      }
      <div style={{ flex: 1 }}>
        <p className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: isSuccess ? 'var(--green)' : 'var(--red)', marginBottom: 2 }}>
          {isSuccess ? 'Order Placed' : 'Order Failed'}
        </p>
        <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {result.message}
        </p>
      </div>
      <button onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>
        ×
      </button>
    </div>
  );
}

function OrderSummary({ symbol, action, qty, price }) {
  if (!symbol || !qty || !price) return null;
  const total = qty * price;
  const isBuy = action === 'BUY';

  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--bg-base)',
      border: `1px solid ${isBuy ? 'rgba(0,229,160,0.15)' : 'rgba(255,77,106,0.15)'}`,
      borderRadius: 8,
    }}>
      <div className="section-label" style={{ marginBottom: 8 }}>Order Preview</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {[
          ['Symbol',    symbol],
          ['Action',    action, isBuy ? 'var(--green)' : 'var(--red)'],
          ['Qty',       `${qty} shares`],
          ['Price',     `₹${Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
          ['Est. Value',`₹${Number(total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, 'var(--cyan)'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
            <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: color || 'var(--text-primary)' }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TradePanel({ symbol, currentPrice, onTrade, disabled }) {
  const [qty,        setQty]        = useState('');
  const [loading,    setLoading]    = useState(null);   // 'BUY' | 'SELL' | null
  const [result,     setResult]     = useState(null);
  const [activeTab,  setActiveTab]  = useState('BUY');

  const qtyNum    = parseInt(qty, 10);
  const validQty  = !isNaN(qtyNum) && qtyNum > 0;
  const canTrade  = !!symbol && validQty && !disabled && !loading;

  async function handleTrade(action) {
    if (!canTrade) return;
    setLoading(action);
    setResult(null);

    try {
      const res = await onTrade({ symbol, action, qty: qtyNum });

      const order = res?.data?.order ?? res?.data ?? {};
      const msg = [
        `${action} ${qtyNum} × ${symbol}`,
        order.orderId    ? `· Order #${order.orderId}` : '',
        order.executedAt ? `· ${new Date(order.executedAt).toLocaleTimeString('en-IN')}` : '',
      ].filter(Boolean).join(' ');

      setResult({ type: 'success', message: msg });
      setQty('');
    } catch (err) {
      const msg = err.response?.data?.error
        || err.response?.data?.message
        || err.message
        || 'Trade failed — please try again';
      setResult({ type: 'error', message: msg });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="section-label" style={{ marginBottom: 3 }}>Manual Trade</div>
          {symbol
            ? <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</span>
            : <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Search a stock first</span>
          }
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

      {/* BUY / SELL tab toggle */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        background: 'var(--bg-base)', borderRadius: 8, padding: 3,
        border: '1px solid var(--border)',
      }}>
        {['BUY', 'SELL'].map(tab => {
          const active = activeTab === tab;
          const isBuy  = tab === 'BUY';
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
                transition: 'all 0.15s',
                background: active ? (isBuy ? 'rgba(0,229,160,0.12)' : 'rgba(255,77,106,0.12)') : 'none',
                color: active ? (isBuy ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)',
                boxShadow: active ? `0 0 12px ${isBuy ? 'rgba(0,229,160,0.15)' : 'rgba(255,77,106,0.15)'}` : 'none',
              }}>
              {tab}
            </button>
          );
        })}
      </div>

      {/* Quantity input */}
      <div>
        <label className="section-label" style={{ display: 'block', marginBottom: 6 }}>Quantity</label>
        <div style={{ position: 'relative' }}>
          <Hash size={12} style={{
            position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="number"
            min="1"
            step="1"
            value={qty}
            onChange={e => setQty(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter shares"
            disabled={!symbol || disabled}
            className="input"
            style={{ paddingLeft: 30 }}
          />
        </div>

        {/* Quick qty chips */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {[1, 5, 10, 25, 50, 100].map(n => (
            <button key={n} type="button"
              onClick={() => setQty(String(n))}
              disabled={!symbol || disabled}
              className="font-mono"
              style={{
                padding: '3px 9px', borderRadius: 5, fontSize: 10,
                cursor: symbol && !disabled ? 'pointer' : 'not-allowed',
                transition: 'all 0.12s',
                background: qty === String(n) ? 'rgba(0,212,255,0.12)' : 'var(--bg-elevated)',
                border: `1px solid ${qty === String(n) ? 'rgba(0,212,255,0.3)' : 'var(--border)'}`,
                color:  qty === String(n) ? 'var(--cyan)' : 'var(--text-muted)',
                opacity: symbol && !disabled ? 1 : 0.4,
              }}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Order preview */}
      {validQty && currentPrice != null && symbol && (
        <OrderSummary symbol={symbol} action={activeTab} qty={qtyNum} price={currentPrice} />
      )}

      {/* Action button */}
      <button
        onClick={() => handleTrade(activeTab)}
        disabled={!canTrade}
        className={activeTab === 'BUY' ? 'btn btn-green' : 'btn btn-red'}
        style={{ width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 13 }}>
        {loading === activeTab
          ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Processing…</>
          : activeTab === 'BUY'
            ? <><TrendingUp size={14} /> BUY {validQty ? `${qtyNum} × ` : ''}{symbol || '—'}</>
            : <><TrendingDown size={14} /> SELL {validQty ? `${qtyNum} × ` : ''}{symbol || '—'}</>
        }
      </button>

      {/* Disabled notice */}
      {!symbol && (
        <p className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: -8 }}>
          Search for a stock above to enable trading
        </p>
      )}

      {/* Result */}
      {result && <TradeResult result={result} onDismiss={() => setResult(null)} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}