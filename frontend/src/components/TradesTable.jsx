import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

function PnlCell({ pnl }) {
  if (pnl == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const isPos = pnl >= 0;
  const Icon  = isPos ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-0.5 font-mono text-xs"
      style={{ color: isPos ? 'var(--accent-green)' : 'var(--accent-red)' }}>
      <Icon size={11} />
      {isPos ? '+' : ''}{Number(pnl).toFixed(2)}%
    </span>
  );
}

function SideBadge({ side }) {
  const isBuy = side === 'BUY';
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
      style={{
        background: isBuy ? 'rgba(0,230,118,0.1)' : 'rgba(255,71,87,0.1)',
        border: `1px solid ${isBuy ? 'rgba(0,230,118,0.25)' : 'rgba(255,71,87,0.25)'}`,
        color: isBuy ? 'var(--accent-green)' : 'var(--accent-red)',
      }}>
      {side}
    </span>
  );
}

const COLS = [
  { key: 'symbol',       label: 'Symbol' },
  { key: 'side',         label: 'Side' },
  { key: 'entryDate',    label: 'Entry' },
  { key: 'exitDate',     label: 'Exit' },
  { key: 'entryPrice',   label: 'Entry ₹' },
  { key: 'exitPrice',    label: 'Exit ₹' },
  { key: 'pnlPct',       label: 'P&L %' },
  { key: 'pnlAmount',    label: 'P&L ₹' },
];

export default function TradesTable({ trades = [], loading = false }) {
  if (loading) return <TableSkeleton />;

  if (!trades.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <Minus size={20} style={{ color: 'var(--text-muted)' }} />
        </div>
        <p className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>No trades yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Run a backtest to populate trades</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {COLS.map(c => (
              <th key={c.key}
                className="text-left py-2 px-3 font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i}
              className="tr-hover transition-colors"
              style={{ borderBottom: '1px solid rgba(30,45,69,0.5)' }}>
              <td className="py-2.5 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t.symbol || t.Symbol || '—'}
              </td>
              <td className="py-2.5 px-3">
                <SideBadge side={t.side || t.Side || 'BUY'} />
              </td>
              <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>
                {formatDate(t.entryDate || t.entry_date)}
              </td>
              <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>
                {formatDate(t.exitDate || t.exit_date) || '—'}
              </td>
              <td className="py-2.5 px-3" style={{ color: 'var(--text-primary)' }}>
                {fmtPrice(t.entryPrice || t.entry_price)}
              </td>
              <td className="py-2.5 px-3" style={{ color: 'var(--text-primary)' }}>
                {fmtPrice(t.exitPrice || t.exit_price) || '—'}
              </td>
              <td className="py-2.5 px-3">
                <PnlCell pnl={t.pnlPct ?? t.pnl_pct ?? t.returnPct} />
              </td>
              <td className="py-2.5 px-3" style={{ color: (t.pnlAmount || t.pnl_amount || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {t.pnlAmount || t.pnl_amount ? `₹${Number(t.pnlAmount || t.pnl_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtPrice(v) {
  if (v == null) return '—';
  return `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function TableSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-9 rounded skeleton" style={{ background: 'var(--bg-elevated)' }} />
      ))}
    </div>
  );
}
