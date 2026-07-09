// src/pages/LiveOrders.jsx — Phase 2 Live Order Book
// ─────────────────────────────────────────────────────────────────────────────
// Real broker order book: pending / completed / cancelled / rejected / partial,
// with average price, filled qty, broker order id, and a cancel action for
// open orders. Read-only sync from /api/live/orders (DB audit merged with the
// live Upstox order book).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import Toast from '../components/Toast';
import { liveAPI } from '../services/api';
import { useTradingMode } from '../context/TradingModeContext';
import { ScrollText, RefreshCw, X, ShieldOff } from 'lucide-react';

const FILTERS = ['ALL', 'PENDING', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'REJECTED'];

const STATUS_COLOR = {
  PENDING:   'var(--amber)',
  COMPLETED: 'var(--green)',
  PARTIAL:   'var(--cyan)',
  CANCELLED: 'var(--text-muted)',
  REJECTED:  'var(--red)',
};

const money = (v) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function LiveOrders() {
  const { brokerLinked } = useTradingMode();
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('ALL');
  const [toast,   setToast]   = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await liveAPI.orders();
      setOrders(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      setToast({ msg: err.response?.data?.error || 'Failed to load orders', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);   // live-ish refresh
    return () => clearInterval(id);
  }, [load]);

  async function cancel(o) {
    if (!o.brokerOrderId) return;
    setCancelling(o.brokerOrderId);
    try {
      await liveAPI.cancelOrder(o.brokerOrderId);
      setToast({ msg: `Cancel requested for ${o.symbol}`, type: 'success' });
      load();
    } catch (err) {
      setToast({ msg: err.response?.data?.error || 'Cancel failed', type: 'error' });
    } finally {
      setCancelling(null);
    }
  }

  const filtered = filter === 'ALL' ? orders : orders.filter(o => o.status === filter);
  const counts = FILTERS.reduce((a, f) => {
    a[f] = f === 'ALL' ? orders.length : orders.filter(o => o.status === f).length;
    return a;
  }, {});

  return (
    <AppShell>
      <main className="page-content">
        <div style={{ maxWidth: 1200 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <ScrollText size={18} style={{ color: 'var(--green)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Live Orders</h1>
            <button onClick={load} className="ws-pill" style={{ marginLeft: 'auto', cursor: 'pointer' }} title="Refresh">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
            Real broker order book · auto-refresh 5s
          </p>

          {!brokerLinked && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--amber) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 24%, transparent)' }}>
              <ShieldOff size={15} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Broker not connected — showing your saved order history only.</span>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {FILTERS.map(f => {
              const active = filter === f;
              return (
                <button key={f} onClick={() => setFilter(f)}
                  style={{
                    padding: '5px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    background: active ? 'color-mix(in srgb, var(--green) 14%, transparent)' : 'var(--bg-elevated)',
                    border: `1px solid ${active ? 'color-mix(in srgb, var(--green) 40%, transparent)' : 'var(--border)'}`,
                    color: active ? 'var(--green)' : 'var(--text-muted)',
                  }}>
                  {f} <span style={{ opacity: 0.6 }}>{counts[f] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <ScrollText size={22} style={{ marginBottom: 10, opacity: 0.5 }} />
              <div style={{ fontSize: 13 }}>{loading ? 'Loading orders…' : 'No orders in this view'}</div>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                    {['Symbol', 'Side', 'Type', 'Product', 'Qty', 'Filled', 'Price', 'Avg', 'Status', 'Broker ID', ''].map(h => (
                      <th key={h} style={{ padding: '10px 12px', fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => (
                    <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {o.symbol}{o.sandbox && <span style={{ marginLeft: 6, fontSize: 8, color: 'var(--amber)' }}>SBX</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: o.side === 'BUY' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{o.side}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{o.orderType}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{o.product || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{o.qty}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{o.filledQty ?? '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{money(o.price)}</td>
                      <td style={{ padding: '10px 12px' }}>{money(o.avgPrice)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ color: STATUS_COLOR[o.status] || 'var(--text-secondary)', fontWeight: 700 }}>● {o.status}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 10.5 }}>{o.brokerOrderId || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {o.status === 'PENDING' && o.brokerOrderId && (
                          <button onClick={() => cancel(o)} disabled={cancelling === o.brokerOrderId}
                            title="Cancel order"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, background: 'color-mix(in srgb, var(--red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)' }}>
                            <X size={11} /> {cancelling === o.brokerOrderId ? '…' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 50 }}>
          <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </AppShell>
  );
}
