// src/components/AllocationCard.jsx
// Portfolio allocation breakdown — derived entirely from the live
// openPositions map (cost basis per symbol as % of total invested).
import { PieChart } from 'lucide-react';
import { EmptyState } from './ui';
import { inrCompact } from '../utils/format';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

const PALETTE = ['var(--cyan)', 'var(--green)', 'var(--purple)', 'var(--amber)', 'var(--red)'];

export default function AllocationCard({ openPositions }) {
  const entries = !openPositions
    ? []
    : Array.isArray(openPositions)
      ? openPositions
      : Object.entries(openPositions).map(([symbol, v]) => ({ symbol, ...(v || {}) }));

  const rows = entries
    .map((p) => {
      const qty = n(p.qty ?? p.quantity ?? p.shares);
      const avg = n(p.avgPrice ?? p.avg_price ?? p.entryPrice ?? p.entry_price ?? p.entry);
      return { symbol: p.symbol || '—', value: qty != null && avg != null ? qty * avg : 0 };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = rows.reduce((s, r) => s + r.value, 0);

  if (!rows.length) {
    return (
      <EmptyState
        icon={PieChart}
        description="No holdings to allocate"
        style={{ padding: '32px 0', border: 'none', background: 'transparent' }}
      />
    );
  }

  return (
    <div className="ui-vstack" style={{ gap: 10 }}>
      {/* Stacked distribution bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
        {rows.map((r, i) => (
          <span
            key={r.symbol}
            title={`${r.symbol} ${(r.value / total * 100).toFixed(1)}%`}
            style={{ width: `${(r.value / total) * 100}%`, background: PALETTE[i % PALETTE.length], opacity: 0.85 }}
          />
        ))}
      </div>

      {rows.map((r, i) => {
        const share = (r.value / total) * 100;
        return (
          <div key={r.symbol} className="ui-vstack" style={{ gap: 5 }}>
            <div className="ui-between">
              <span className="ui-hstack" style={{ gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                <span className="sym" style={{ fontSize: 12 }}>{r.symbol}</span>
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {inrCompact(r.value)} · <b style={{ color: 'var(--text-primary)' }}>{share.toFixed(1)}%</b>
              </span>
            </div>
            <div className="meter">
              <span style={{ width: `${share}%`, background: PALETTE[i % PALETTE.length] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
