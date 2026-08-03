// src/components/LiveOrderModal.jsx — Phase 2 charges confirmation modal
// ─────────────────────────────────────────────────────────────────────────────
// Shown before a real-money order is sent. Fetches a live brokerage/charges
// preview from the backend (Upstox charges API → local estimate fallback) and
// displays the full breakdown + risk warning. Nothing is submitted until the
// user clicks Confirm Order.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { AlertTriangle, Zap, X, Loader2 } from 'lucide-react';
import { liveAPI } from '../services/api';

const inr = (v) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, strong, color }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '6px 0', borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
      <span style={{ fontSize: strong ? 13 : 12, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: strong ? 700 : 600 }}>{value}</span>
    </div>
  );
}

// A rejected real-money order must say WHY, and say what to do about it. The
// backend already returns a machine-readable `code` alongside its message; the
// UI previously dropped both and surfaced a transient toast, so a 503 looked
// like "nothing happened" unless you had the console open.
//
// Each entry adds the one thing the raw message can't: the next action.
//
// Keys must match the `code` values thrown by liveTradingService exactly.
// test-kill-switch.js diffs the two lists — the first version of this map used
// invented names (ORDER_VALUE_LIMIT, INSUFFICIENT_FUNDS) that no code path ever
// emits, so the help silently never rendered.
export const REJECTION_HELP = {
  // Safety halts
  KILL_SWITCH:           'The kill switch is engaged, so no live orders can be sent. It engages after an Emergency Stop, a daily-loss halt, or the dead-man switch. Disengage it from Risk & Emergency once you know why it fired.',
  DAILY_LOSS_LIMIT:      'Today’s loss has reached your configured limit and new entries are halted. This resets tomorrow; raising the limit mid-drawdown is usually the wrong call.',
  MARKET_CLOSED:         'NSE accepts orders 9:15–15:30 IST, Monday to Friday.',
  // Authorisation
  BROKER_NOT_CONNECTED:  'No broker is linked to your account. Connect Upstox first.',
  BROKER_NOT_YOURS:      'This broker session belongs to a different account. Connect your own Upstox account to trade.',
  // Risk limits — all configurable in Risk & Emergency
  QTY_LIMIT:             'Quantity exceeds your per-order limit.',
  VALUE_LIMIT:           'Order value exceeds your per-order limit.',
  MAX_POSITION_SIZE:     'This would push the position beyond your maximum size for a single symbol.',
  MAX_EXPOSURE:          'This would push total exposure beyond your portfolio limit.',
  MAX_ORDERS:            'You have reached your maximum number of orders for today.',
  // Request problems — these indicate a client bug, not a policy block
  DUPLICATE:             'An identical order was placed within the last 10 seconds and was suppressed. Wait, or change the quantity if the repeat is intentional.',
  CONFIRMATION_REQUIRED: 'The order reached the server without explicit confirmation. That is a client bug rather than a limit.',
  BAD_QTY:               'Quantity must be greater than zero.',
  BAD_ORDER_TYPE:        'Unrecognised order type.',
  PRICE_REQUIRED:        'A limit order needs a limit price.',
  TRIGGER_REQUIRED:      'A stop order needs a trigger price.',
  // Downstream
  BROKER_REJECTED:       'Upstox rejected the order. The broker’s own message is shown above — margin, circuit limits and instrument state are the usual causes.',
  NO_POSITION:           'There is no open position to exit for this symbol.',
};

export default function LiveOrderModal({ order, onConfirm, onCancel, loading, error }) {
  const [charges, setCharges] = useState(null);
  const [loadingCharges, setLoadingCharges] = useState(false);

  useEffect(() => {
    if (!order) { setCharges(null); return; }
    setLoadingCharges(true);
    liveAPI.charges({
      symbol: order.symbol, side: order.side, qty: order.qty,
      price: order.price ?? order.currentPrice ?? 0, product: order.product,
    })
      .then(r => setCharges(r.data?.charges || null))
      .catch(() => setCharges(null))
      .finally(() => setLoadingCharges(false));
  }, [order]);

  if (!order) return null;
  const { symbol, side, qty, orderType, product, validity, isAmo, exchange = 'NSE', estValue } = order;
  const isBuy = side === 'BUY';
  const totalCharges = charges?.total;
  const approxTotal  = estValue != null && totalCharges != null
    ? (isBuy ? estValue + totalCharges : estValue - totalCharges)
    : estValue;

  return (
    // NOTE: no align-items:center here — a centered flex child taller than the
    // viewport gets its top clipped and unreachable. `margin:auto` on the card
    // centers it when it fits and allows full scrolling when it doesn't.
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', overflowY: 'auto', padding: '24px 16px' }}>
      <div className="card fade-in" style={{ width: '100%', maxWidth: 440, padding: 24, margin: 'auto', border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)', boxShadow: '0 0 40px color-mix(in srgb, var(--amber) 8%, transparent)' }}>
        {/* Header */}
        <div className="flex items-start justify-between" style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-3">
            <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={18} style={{ color: 'var(--amber)' }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Confirm Order</div>
              <div style={{ fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>REAL MONEY · {exchange}</div>
            </div>
          </div>
          <button onClick={onCancel} style={{ color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
        </div>

        {/* Order details */}
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid var(--border)' }}>
          <Row label="Stock" value={symbol} />
          <Row label="Exchange" value={exchange} />
          <Row label="Side" value={<span style={{ color: isBuy ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{side}</span>} />
          <Row label="Quantity" value={`${qty}`} />
          <Row label="Type" value={`${orderType}${isAmo ? ' · AMO' : ''}`} />
          <Row label="Product / Validity" value={`${product} · ${validity}`} />
          <Row label="Estimated Value" value={inr(estValue)} strong color="var(--cyan)" />
        </div>

        {/* Charges */}
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Charges</span>
            {charges?.source && (
              <span style={{ fontSize: 8.5, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {charges.source === 'UPSTOX' ? 'UPSTOX' : 'ESTIMATE'}
              </span>
            )}
          </div>
          {loadingCharges ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: 'var(--text-muted)', fontSize: 11 }}>
              <Loader2 size={13} className="animate-spin" /> Fetching charges…
            </div>
          ) : (
            <>
              <Row label="Brokerage" value={inr(charges?.brokerage)} />
              <Row label="Exchange Charges" value={inr(charges?.exchange)} />
              <Row label="GST" value={inr(charges?.gst)} />
              <Row label="STT" value={inr(charges?.stt)} />
              <Row label="SEBI" value={inr(charges?.sebi)} />
              <Row label="Stamp Duty" value={inr(charges?.stampDuty)} />
              <Row label="Total Charges" value={inr(charges?.total)} strong color="var(--amber)" />
            </>
          )}
        </div>

        {/* Approx total + margin */}
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, border: '1px solid var(--border)' }}>
          <Row label={isBuy ? 'Approx Total Debit' : 'Approx Net Credit'} value={inr(approxTotal)} strong color={isBuy ? 'var(--red)' : 'var(--green)'} />
          <Row label="Margin Required" value={inr(product === 'MIS' ? (estValue ? estValue * 0.2 : null) : estValue)} />
        </div>

        {/* Rejection — stays on screen until the user acts, unlike a toast.
            The order was NOT placed, so this must be unmissable. */}
        {error && (
          <div role="alert" style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 12, background: 'color-mix(in srgb, var(--red) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)' }}>
            <div className="flex items-center gap-2" style={{ marginBottom: error.help ? 5 : 0 }}>
              <AlertTriangle size={13} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>
                Order not placed{error.code ? ` — ${error.code.replace(/_/g, ' ').toLowerCase()}` : ''}
              </span>
            </div>
            {error.message && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: error.help ? 4 : 0 }}>
                {error.message}
              </div>
            )}
            {error.help && (
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{error.help}</div>
            )}
          </div>
        )}

        {/* Risk warning */}
        <div style={{ padding: '9px 12px', borderRadius: 8, marginBottom: 16, background: 'color-mix(in srgb, var(--amber) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 20%, transparent)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--amber)' }}>Risk warning:</strong> this places a real order with your broker. Charges shown are an estimate and may differ from the final contract note. Orders cannot be undone once executed.
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading} className="flex-1 py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
            style={{ background: isBuy ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'color-mix(in srgb, var(--red) 15%, transparent)', border: `1px solid ${isBuy ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'color-mix(in srgb, var(--red) 40%, transparent)'}`, color: isBuy ? 'var(--green)' : 'var(--red)', opacity: loading ? 0.6 : 1 }}>
            {loading ? <><Loader2 size={13} className="animate-spin" /> Placing…</> : <><Zap size={13} /> {error ? 'Retry Order' : 'Confirm Order'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
