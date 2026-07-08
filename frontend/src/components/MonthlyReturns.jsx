// src/components/MonthlyReturns.jsx
// Monthly P&L heatmap — aggregated from the actual backtest trade log
// (sum of pnlAmount by exit month). No fabricated data: renders nothing
// until trades exist.
import { useMemo } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export default function MonthlyReturns({ trades = [], initialCapital = 1000000 }) {
  const { years, byKey, maxAbs } = useMemo(() => {
    const byKey = {};
    for (const t of trades) {
      const d = new Date(t.exitDate || t.exit_date || t.entryDate || t.entry_date || 0);
      if (Number.isNaN(d.getTime())) continue;
      const pnl = n(t.pnlAmount ?? t.pnl_amount);
      if (pnl == null) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      byKey[key] = (byKey[key] || 0) + pnl;
    }
    const years = [...new Set(Object.keys(byKey).map((k) => k.split('-')[0]))].sort();
    const maxAbs = Math.max(1, ...Object.values(byKey).map((v) => Math.abs(v)));
    return { years, byKey, maxAbs };
  }, [trades]);

  if (!years.length) return null;

  return (
    <div className="hm-wrap">
      <div className="hm-grid" style={{ gridTemplateColumns: '48px repeat(12, 1fr)' }}>
        <div className="hm-head" />
        {MONTHS.map((m) => <div key={m} className="hm-head">{m}</div>)}

        {years.map((y) => (
          <MonthRow key={y} year={y} byKey={byKey} maxAbs={maxAbs} initialCapital={initialCapital} />
        ))}
      </div>
    </div>
  );
}

function MonthRow({ year, byKey, maxAbs, initialCapital }) {
  return (
    <>
      <div className="hm-head" style={{ justifyContent: 'flex-start' }}>{year}</div>
      {MONTHS.map((_, m) => {
        const v = byKey[`${year}-${m}`];
        if (v == null) return <div key={m} className="hm-cell" style={{ opacity: 0.45 }} aria-hidden="true" />;
        const intensity = Math.round(8 + (Math.abs(v) / maxAbs) * 30); // 8–38%
        const tokenColor = v >= 0 ? 'var(--green)' : 'var(--red)';
        const retPct = (v / (initialCapital || 1)) * 100;
        return (
          <div
            key={m}
            className="hm-cell"
            title={`${MONTHS[m]} ${year}: ${v >= 0 ? '+' : ''}₹${Math.round(v).toLocaleString('en-IN')}`}
            style={{
              background: `color-mix(in srgb, ${tokenColor} ${intensity}%, var(--bg-elevated))`,
              color: `color-mix(in srgb, ${tokenColor} 80%, var(--text-primary))`,
            }}
          >
            {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
          </div>
        );
      })}
    </>
  );
}
