import { Layers } from 'lucide-react';
import { DataTable, Badge, EmptyState } from './ui';
import { price, inr, pct, colorOf } from '../utils/format';

/**
 * OpenPositions — renders the portfolio's open positions.
 * Accepts the normalized `openPositions` map from WSContext (keyed by symbol)
 * and tolerates the varied field names the backend emits.
 */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function normalize(openPositions) {
  if (!openPositions) return [];
  const entries = Array.isArray(openPositions)
    ? openPositions
    : Object.entries(openPositions).map(([symbol, v]) => ({ symbol, ...(v || {}) }));
  return entries.map((p) => {
    const qty = n(p.qty ?? p.quantity ?? p.shares);
    const avg = n(p.avgPrice ?? p.avg_price ?? p.entryPrice ?? p.entry_price ?? p.entry);
    const ltp = n(p.ltp ?? p.lastPrice ?? p.currentPrice ?? p.price ?? p.mark);
    let pnl = n(p.pnl ?? p.unrealizedPnl ?? p.unrealized_pnl ?? p.openPnl);
    let pnlPct = n(p.pnlPct ?? p.pnl_pct ?? p.returnPct);
    if (pnl == null && qty != null && avg != null && ltp != null) pnl = (ltp - avg) * qty;
    if (pnlPct == null && avg && ltp != null) pnlPct = ((ltp - avg) / avg) * 100;
    return { symbol: p.symbol || p.Symbol || '—', side: (p.side || p.action || 'BUY').toUpperCase(), qty, avg, ltp, pnl, pnlPct };
  });
}

export default function OpenPositions({ openPositions }) {
  const rows = normalize(openPositions);

  const columns = [
    { key: 'symbol', label: 'Symbol', render: (r) => <span className="sym">{r.symbol}</span> },
    { key: 'side', label: 'Side', render: (r) => <Badge tone={r.side === 'SELL' ? 'sell' : 'buy'}>{r.side}</Badge> },
    { key: 'qty', label: 'Qty', align: 'right', render: (r) => <span className="num">{r.qty ?? '—'}</span> },
    { key: 'avg', label: 'Avg', align: 'right', render: (r) => <span className="num">{r.avg != null ? price(r.avg) : '—'}</span> },
    { key: 'ltp', label: 'LTP', align: 'right', render: (r) => <span className="num" style={{ color: 'var(--text-primary)' }}>{r.ltp != null ? price(r.ltp) : '—'}</span> },
    {
      key: 'pnl', label: 'P&L', align: 'right',
      render: (r) => (
        <span className="num" style={{ color: colorOf(r.pnl), fontWeight: 600 }}>
          {r.pnl != null ? inr(r.pnl, { sign: true }) : '—'}
          {r.pnlPct != null && <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 5 }}>{pct(r.pnlPct)}</span>}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.symbol}
      empty={<EmptyState icon={Layers} description="No open positions" style={{ padding: '36px 0', border: 'none', background: 'transparent' }} />}
    />
  );
}
