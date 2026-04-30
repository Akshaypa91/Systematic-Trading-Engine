// src/components/PositionsTable.jsx — with individual Exit button
import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, X, Loader2 } from 'lucide-react';
import { simAPI } from '../services/api';

const fmt = (n, dec = 2) =>
  Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

function PnLBadge({ pnl, pnlPct }) {
  const pos   = pnl > 0;
  const neg   = pnl < 0;
  const color = pos ? 'var(--green)' : neg ? 'var(--red)' : 'var(--text-muted)';
  const bg    = pos ? 'rgba(34,197,94,0.08)' : neg ? 'rgba(239,68,68,0.08)' : 'transparent';
  const Icon  = pos ? TrendingUp : neg ? TrendingDown : Minus;
  return (
    <div style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding:'2px 8px', borderRadius:6,
      background:bg, color,
      fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700,
    }}>
      <Icon size={10} />
      {pos ? '+' : ''}{fmt(pnl, 0)}
      <span style={{ fontSize:10, opacity:0.8 }}>
        ({pos ? '+' : ''}{fmt(pnlPct, 1)}%)
      </span>
    </div>
  );
}

export default function PositionsTable({ positions, biggestGainer, biggestLoser, onExited }) {
  const [exiting, setExiting] = useState({}); // symbol → true/false
  const [results, setResults] = useState({}); // symbol → { pnl, error }

  const entries = Object.entries(positions ?? {});
  if (entries.length === 0) {
    return (
      <p className="font-mono" style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', padding:'16px 0' }}>
        No open positions
      </p>
    );
  }

  const isGainer = (sym) => biggestGainer?.symbol === sym && biggestGainer.pnlPct > 0;
  const isLoser  = (sym) => biggestLoser?.symbol  === sym && biggestLoser.pnlPct  < 0;

  async function handleExit(sym) {
    setExiting(prev => ({ ...prev, [sym]: true }));
    setResults(prev => ({ ...prev, [sym]: null }));
    try {
      const res = await simAPI.exitOne(sym);
      const pnl = res.data?.realizedPnL ?? 0;
      setResults(prev => ({ ...prev, [sym]: { pnl, ok: true } }));
      setTimeout(() => {
        setResults(prev => { const n = {...prev}; delete n[sym]; return n; });
        if (onExited) onExited(res.data?.portfolio);
      }, 1800);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed';
      setResults(prev => ({ ...prev, [sym]: { error: msg, ok: false } }));
      setTimeout(() => setResults(prev => { const n = {...prev}; delete n[sym]; return n; }), 3000);
    } finally {
      setExiting(prev => ({ ...prev, [sym]: false }));
    }
  }

  return (
    <div className="positions-table-wrap" style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'var(--font-mono)', fontSize:11 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            {['Symbol', 'Qty', 'Entry ₹', 'Current ₹', 'Value ₹', 'PnL', ''].map(h => (
              <th key={h} style={{
                padding:'6px 8px', textAlign: h === 'Symbol' || h === '' ? 'left' : 'right',
                color:'var(--text-muted)', fontWeight:500, fontSize:10,
                letterSpacing:'0.05em', whiteSpace:'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([sym, pos]) => {
            const highlight = isGainer(sym)
              ? 'rgba(34,197,94,0.04)'
              : isLoser(sym)
              ? 'rgba(239,68,68,0.04)'
              : 'transparent';

            const badge = isGainer(sym)
              ? { label:'🏆 Top', color:'var(--green)', bg:'rgba(34,197,94,0.10)' }
              : isLoser(sym)
              ? { label:'📉 Low', color:'var(--red)',   bg:'rgba(239,68,68,0.10)' }
              : null;

            const busy   = exiting[sym];
            const result = results[sym];

            return (
              <tr key={sym}
                className="trade-row"
                style={{ borderBottom:'1px solid var(--border)', background: highlight }}
              >
                {/* Symbol */}
                <td style={{ padding:'9px 8px', color:'var(--text-primary)', fontWeight:700 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{
                      width:6, height:6, borderRadius:'50%', flexShrink:0,
                      background:'var(--cyan)',
                    }} />
                    {sym}
                    {badge && (
                      <span style={{ padding:'1px 5px', borderRadius:4, fontSize:9, background:badge.bg, color:badge.color, fontWeight:700 }}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                </td>
                {/* Qty */}
                <td style={{ padding:'9px 8px', textAlign:'right', color:'var(--text-secondary)' }}>
                  {pos.qty}
                </td>
                {/* Entry */}
                <td style={{ padding:'9px 8px', textAlign:'right', color:'var(--text-secondary)' }}>
                  {fmt(pos.entryPrice)}
                </td>
                {/* Current */}
                <td style={{ padding:'9px 8px', textAlign:'right', color:'var(--cyan)', fontWeight:600 }}>
                  {fmt(pos.currentPrice ?? pos.entryPrice)}
                </td>
                {/* Value */}
                <td style={{ padding:'9px 8px', textAlign:'right', color:'var(--text-secondary)' }}>
                  {fmt(pos.currentValue ?? pos.qty * pos.entryPrice, 0)}
                </td>
                {/* PnL */}
                <td style={{ padding:'9px 8px', textAlign:'right' }}>
                  {result?.ok ? (
                    <span style={{
                      fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700,
                      color: result.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                      animation:'fadeUp 0.2s ease-out',
                    }}>
                      {result.pnl >= 0 ? '+' : '−'}₹{fmt(Math.abs(result.pnl), 0)} closed
                    </span>
                  ) : result?.error ? (
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--red)' }}>
                      {result.error}
                    </span>
                  ) : (
                    <PnLBadge pnl={pos.pnl ?? 0} pnlPct={pos.pnlPct ?? 0} />
                  )}
                </td>
                {/* Exit button */}
                <td style={{ padding:'9px 8px', textAlign:'left' }}>
                  <button
                    onClick={() => handleExit(sym)}
                    disabled={busy}
                    title={`Exit ${sym} position`}
                    style={{
                      display:'inline-flex', alignItems:'center', gap:4,
                      padding:'3px 9px', borderRadius:6, cursor: busy ? 'wait' : 'pointer',
                      border:'1px solid rgba(239,68,68,0.25)',
                      background:'rgba(239,68,68,0.06)',
                      color:'var(--red)',
                      fontFamily:'var(--font-mono)', fontSize:10, fontWeight:600,
                      opacity: busy ? 0.6 : 1,
                      transition:'all 0.12s',
                      whiteSpace:'nowrap',
                    }}
                    onMouseEnter={e => { if (!busy) { e.currentTarget.style.background='rgba(239,68,68,0.14)'; e.currentTarget.style.borderColor='rgba(239,68,68,0.4)'; } }}
                    onMouseLeave={e => { e.currentTarget.style.background='rgba(239,68,68,0.06)'; e.currentTarget.style.borderColor='rgba(239,68,68,0.25)'; }}
                  >
                    {busy
                      ? <Loader2 size={9} className="animate-spin" />
                      : <X size={9} />
                    }
                    {busy ? 'Exiting…' : 'Exit'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
