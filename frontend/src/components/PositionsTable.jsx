// src/components/PositionsTable.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Full position table: symbol | qty | entry | current | PnL | %
// Green profit, red loss. Highlights biggest gainer/loser.
// ─────────────────────────────────────────────────────────────────────────────
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const fmt = (n, dec = 2) =>
  Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

function PnLBadge({ pnl, pnlPct }) {
  const pos   = pnl > 0;
  const neg   = pnl < 0;
  const color = pos ? 'var(--green)' : neg ? 'var(--red)' : 'var(--text-muted)';
  const bg    = pos ? 'rgba(0,229,160,0.08)' : neg ? 'rgba(255,77,106,0.08)' : 'transparent';
  const Icon  = pos ? TrendingUp : neg ? TrendingDown : Minus;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6,
      background: bg, color,
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
    }}>
      <Icon size={10} />
      {pos ? '+' : ''}{fmt(pnl, 0)}
      <span style={{ fontSize: 10, opacity: 0.8 }}>
        ({pos ? '+' : ''}{fmt(pnlPct, 1)}%)
      </span>
    </div>
  );
}

export default function PositionsTable({ positions, biggestGainer, biggestLoser }) {
  const entries = Object.entries(positions ?? {});

  if (entries.length === 0) {
    return (
      <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
        No open positions
      </p>
    );
  }

  const isGainer = (sym) => biggestGainer?.symbol === sym && biggestGainer.pnlPct > 0;
  const isLoser  = (sym) => biggestLoser?.symbol  === sym && biggestLoser.pnlPct  < 0;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontFamily: 'var(--font-mono)', fontSize: 11,
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Symbol', 'Qty', 'Entry ₹', 'Current ₹', 'Value ₹', 'PnL'].map(h => (
              <th key={h} style={{
                padding: '6px 8px', textAlign: h === 'Symbol' ? 'left' : 'right',
                color: 'var(--text-dim)', fontWeight: 600, fontSize: 10,
                letterSpacing: '0.05em', whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([sym, pos]) => {
            const highlight = isGainer(sym)
              ? 'rgba(0,229,160,0.04)'
              : isLoser(sym)
              ? 'rgba(255,77,106,0.04)'
              : 'transparent';

            const badge = isGainer(sym)
              ? { label: '🏆 Top', color: 'var(--green)', bg: 'rgba(0,229,160,0.10)' }
              : isLoser(sym)
              ? { label: '📉 Low', color: 'var(--red)',   bg: 'rgba(255,77,106,0.10)' }
              : null;

            return (
              <tr key={sym} style={{
                borderBottom: '1px solid var(--border)',
                background: highlight,
                transition: 'background 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = highlight}
              >
                {/* Symbol */}
                <td style={{ padding: '8px 8px', color: 'var(--text-primary)', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: 'var(--cyan)',
                      boxShadow: '0 0 5px rgba(0,212,255,0.5)',
                      flexShrink: 0,
                    }} />
                    {sym}
                    {badge && (
                      <span style={{
                        padding: '1px 5px', borderRadius: 4, fontSize: 9,
                        background: badge.bg, color: badge.color, fontWeight: 700,
                      }}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                </td>
                {/* Qty */}
                <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {pos.qty}
                </td>
                {/* Entry */}
                <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {fmt(pos.entryPrice)}
                </td>
                {/* Current */}
                <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--cyan)', fontWeight: 600 }}>
                  {fmt(pos.currentPrice ?? pos.entryPrice)}
                </td>
                {/* Value */}
                <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {fmt(pos.currentValue ?? pos.qty * pos.entryPrice, 0)}
                </td>
                {/* PnL */}
                <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                  <PnLBadge pnl={pos.pnl ?? 0} pnlPct={pos.pnlPct ?? 0} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
