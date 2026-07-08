// src/components/TradesTable.jsx — v2 on the DataTable primitive.
// Sticky header, sortable columns, pagination for long logs, colored PnL.
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { DataTable, Badge, EmptyState } from './ui';
import { price } from '../utils/format';

function PnlCell({ pnl }) {
  if (pnl == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const pos = pnl >= 0;
  const Icon = pos ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: pos ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
      <Icon size={10} aria-hidden="true" />{pos ? '+' : ''}{Number(pnl).toFixed(2)}%
    </span>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export default function TradesTable({ trades = [], loading = false, pageSize = 15 }) {
  const columns = [
    { key: 'symbol', label: 'Symbol', render: (t) => <span className="sym">{t.symbol || t.Symbol || '—'}</span>, sortValue: (t) => t.symbol || '' },
    { key: 'side', label: 'Side', render: (t) => <Badge tone={(t.side || 'BUY') === 'SELL' ? 'sell' : 'buy'}>{t.side || t.Side || 'BUY'}</Badge>, sortValue: (t) => t.side || '' },
    { key: 'entryDate', label: 'Entry', render: (t) => <span className="num" style={{ fontSize: 11 }}>{fmt(t.entryDate || t.entry_date)}</span>, sortValue: (t) => new Date(t.entryDate || t.entry_date || 0).getTime() },
    { key: 'exitDate', label: 'Exit', render: (t) => <span className="num" style={{ fontSize: 11 }}>{fmt(t.exitDate || t.exit_date)}</span>, sortValue: (t) => new Date(t.exitDate || t.exit_date || 0).getTime() },
    { key: 'entryPrice', label: 'Entry ₹', align: 'right', render: (t) => <span className="num">{price(num(t.entryPrice ?? t.entry_price))}</span>, sortValue: (t) => num(t.entryPrice ?? t.entry_price) ?? 0 },
    { key: 'exitPrice', label: 'Exit ₹', align: 'right', render: (t) => <span className="num">{price(num(t.exitPrice ?? t.exit_price))}</span>, sortValue: (t) => num(t.exitPrice ?? t.exit_price) ?? 0 },
    { key: 'pnlPct', label: 'P&L %', align: 'right', render: (t) => <PnlCell pnl={num(t.pnlPct ?? t.pnl_pct ?? t.returnPct)} />, sortValue: (t) => num(t.pnlPct ?? t.pnl_pct ?? t.returnPct) ?? 0 },
    {
      key: 'pnlAmount', label: 'P&L ₹', align: 'right',
      render: (t) => {
        const pnl = num(t.pnlAmount ?? t.pnl_amount);
        return (
          <span className="num" style={{ fontWeight: 600, color: pnl == null ? 'var(--text-muted)' : pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {pnl != null ? `${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
          </span>
        );
      },
      sortValue: (t) => num(t.pnlAmount ?? t.pnl_amount) ?? 0,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={trades}
      loading={loading}
      sortable
      pageSize={pageSize}
      empty={
        <EmptyState
          icon={ArrowUpRight}
          title="No trades yet"
          description="Run a backtest to populate trade history"
          style={{ padding: '40px 0', border: 'none', background: 'transparent' }}
        />
      }
    />
  );
}
