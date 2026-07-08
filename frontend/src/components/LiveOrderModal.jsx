// LiveOrderModal.jsx — confirmation modal for real-money orders
import { AlertTriangle, Zap, X } from 'lucide-react';

export default function LiveOrderModal({ order, onConfirm, onCancel, loading }) {
  if (!order) return null;
  const { symbol, side, qty, price, estTotal } = order;
  const isBuy = side === 'BUY';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="card fade-in" style={{
        width: '100%', maxWidth: 420, padding: 28, margin: 16,
        border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)',
        boxShadow: '0 0 40px color-mix(in srgb, var(--amber) 8%, transparent)',
      }}>
        {/* Header */}
        <div className="flex items-start justify-between" style={{ marginBottom: 20 }}>
          <div className="flex items-center gap-3">
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={18} style={{ color: 'var(--amber)' }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                Confirm Live Order
              </div>
              <div style={{ fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
                REAL MONEY · NSE
              </div>
            </div>
          </div>
          <button onClick={onCancel} style={{ color: 'var(--text-muted)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Warning */}
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 20,
          background: 'color-mix(in srgb, var(--amber) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 20%, transparent)',
          fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          You are about to place a <strong style={{ color: 'var(--amber)' }}>LIVE market order</strong> with
          real money. This action cannot be undone once submitted to the broker.
        </div>

        {/* Order details */}
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: 10, padding: 16,
          marginBottom: 20, border: '1px solid var(--border)',
        }}>
          {[
            ['Symbol',    symbol],
            ['Action',    <span style={{ color: isBuy ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{side}</span>],
            ['Quantity',  `${qty} shares`],
            ['Type',      'MARKET ORDER'],
            ['Est. Total', <strong style={{ color: 'var(--cyan)' }}>₹{Number(estTotal||0).toLocaleString('en-IN')}</strong>],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between" style={{
              padding: '6px 0', borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
            style={{
              background: isBuy ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'color-mix(in srgb, var(--red) 15%, transparent)',
              border: `1px solid ${isBuy ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'color-mix(in srgb, var(--red) 40%, transparent)'}`,
              color: isBuy ? 'var(--green)' : 'var(--red)',
              opacity: loading ? 0.6 : 1,
            }}>
            {loading ? 'Placing...' : <><Zap size={13} /> Confirm {side}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
