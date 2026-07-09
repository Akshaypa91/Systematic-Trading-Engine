// src/components/LiveOrderPanel.jsx — Phase 2 (Live Trading)
// ─────────────────────────────────────────────────────────────────────────────
// Real-money order ticket. Only rendered in LIVE mode (the Trade page swaps
// the paper TradePanel for this). Collects the full Upstox order spec and hands
// a normalized order object up to the parent, which shows the charges
// confirmation modal before anything is sent.
//
// Order types: MARKET | LIMIT | SL | SL-M   Product: CNC | MIS | NRML
// Validity: DAY | IOC | AMO                 + Trigger price, Disclosed qty
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { Zap, TrendingUp, TrendingDown } from 'lucide-react';

const ORDER_TYPES = ['MARKET', 'LIMIT', 'SL', 'SL-M'];
const PRODUCTS     = ['CNC', 'MIS', 'NRML'];
const VALIDITIES   = ['DAY', 'IOC', 'AMO'];

function Seg({ options, value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = value === o;
        return (
          <button key={o} type="button" disabled={disabled} onClick={() => onChange(o)}
            style={{
              flex: 1, minWidth: 52, padding: '6px 8px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)',
              background: active ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--bg-elevated)',
              border: `1px solid ${active ? 'color-mix(in srgb, var(--green) 45%, transparent)' : 'var(--border)'}`,
              color: active ? 'var(--green)' : 'var(--text-muted)',
            }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5, fontFamily: 'var(--font-mono)' }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 7, fontSize: 13, fontFamily: 'var(--font-mono)',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)',
};

export default function LiveOrderPanel({ symbol, currentPrice, onReview, disabled, sandbox }) {
  const [side,        setSide]        = useState('BUY');
  const [orderType,   setOrderType]   = useState('MARKET');
  const [product,     setProduct]     = useState('CNC');
  const [validity,    setValidity]    = useState('DAY');
  const [qty,         setQty]         = useState(1);
  const [price,       setPrice]       = useState('');
  const [trigger,     setTrigger]     = useState('');
  const [disclosed,   setDisclosed]   = useState('');
  const [err,         setErr]         = useState(null);

  const needsPrice   = orderType === 'LIMIT' || orderType === 'SL';
  const needsTrigger = orderType === 'SL' || orderType === 'SL-M';
  const isAmo        = validity === 'AMO';

  const effPrice = needsPrice ? Number(price) : Number(currentPrice) || 0;
  const estValue = (Number(qty) || 0) * effPrice;

  function submit() {
    setErr(null);
    if (!symbol)            return setErr('Select a symbol first');
    if (!(Number(qty) > 0)) return setErr('Quantity must be greater than 0');
    if (needsPrice && !(Number(price) > 0))     return setErr(`${orderType} needs a limit price`);
    if (needsTrigger && !(Number(trigger) > 0)) return setErr(`${orderType} needs a trigger price`);

    onReview({
      symbol, side, qty: parseInt(qty, 10),
      orderType,
      product,
      validity: isAmo ? 'DAY' : validity,   // AMO is a flag, not a validity on Upstox
      isAmo,
      price:        needsPrice ? Number(price) : null,
      triggerPrice: needsTrigger ? Number(trigger) : 0,
      disclosedQty: disclosed ? parseInt(disclosed, 10) : 0,
      currentPrice: Number(currentPrice) || 0,
      estValue,
      exchange: 'NSE',
    });
  }

  const buy = side === 'BUY';

  return (
    <div className="card" style={{ padding: 16, border: '1px solid color-mix(in srgb, var(--green) 28%, transparent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Zap size={15} style={{ color: 'var(--green)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Live Order</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{symbol || '—'}</span>
        {sandbox && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'color-mix(in srgb, var(--amber) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 34%, transparent)', color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>SANDBOX</span>
        )}
      </div>

      {/* BUY / SELL */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['BUY', 'SELL'].map(s => {
          const active = side === s;
          const c = s === 'BUY' ? 'var(--green)' : 'var(--red)';
          const Icon = s === 'BUY' ? TrendingUp : TrendingDown;
          return (
            <button key={s} type="button" onClick={() => setSide(s)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: active ? `color-mix(in srgb, ${c} 16%, transparent)` : 'var(--bg-elevated)',
                border: `1px solid ${active ? `color-mix(in srgb, ${c} 50%, transparent)` : 'var(--border)'}`,
                color: active ? c : 'var(--text-muted)',
              }}>
              <Icon size={14} /> {s}
            </button>
          );
        })}
      </div>

      <Labeled label="Order Type"><Seg options={ORDER_TYPES} value={orderType} onChange={setOrderType} disabled={disabled} /></Labeled>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Labeled label="Quantity">
          <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={inputStyle} />
        </Labeled>
        <Labeled label={needsPrice ? 'Limit Price' : 'Price (mkt)'}>
          <input type="number" min="0" step="0.05" value={needsPrice ? price : (currentPrice ? Number(currentPrice).toFixed(2) : '')}
            disabled={!needsPrice} onChange={e => setPrice(e.target.value)}
            placeholder={needsPrice ? 'required' : 'market'} style={{ ...inputStyle, opacity: needsPrice ? 1 : 0.55 }} />
        </Labeled>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Labeled label="Trigger Price">
          <input type="number" min="0" step="0.05" value={trigger} disabled={!needsTrigger}
            onChange={e => setTrigger(e.target.value)} placeholder={needsTrigger ? 'required' : '—'}
            style={{ ...inputStyle, opacity: needsTrigger ? 1 : 0.55 }} />
        </Labeled>
        <Labeled label="Disclosed Qty">
          <input type="number" min="0" value={disclosed} onChange={e => setDisclosed(e.target.value)} placeholder="0" style={inputStyle} />
        </Labeled>
      </div>

      <Labeled label="Product"><Seg options={PRODUCTS} value={product} onChange={setProduct} disabled={disabled} /></Labeled>
      <Labeled label="Validity"><Seg options={VALIDITIES} value={validity} onChange={setValidity} disabled={disabled} /></Labeled>

      {/* Estimated value */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Est. Value</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
          ₹{estValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
      </div>

      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>{err}</div>}

      <button type="button" onClick={submit} disabled={disabled || !symbol}
        style={{
          width: '100%', padding: '11px 0', borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: (disabled || !symbol) ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          background: `color-mix(in srgb, ${buy ? 'var(--green)' : 'var(--red)'} 16%, transparent)`,
          border: `1px solid color-mix(in srgb, ${buy ? 'var(--green)' : 'var(--red)'} 50%, transparent)`,
          color: buy ? 'var(--green)' : 'var(--red)', opacity: (disabled || !symbol) ? 0.5 : 1,
        }}>
        <Zap size={14} /> Review {side} Order
      </button>
    </div>
  );
}
