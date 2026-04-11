import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

function PnlCell({ pnl }) {
  if (pnl == null) return <span style={{ color:'var(--text-muted)' }}>—</span>;
  const pos = pnl >= 0;
  const Icon = pos ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-0.5 font-mono" style={{ fontSize:11, color: pos ? 'var(--green)' : 'var(--red)' }}>
      <Icon size={10} />{pos ? '+' : ''}{Number(pnl).toFixed(2)}%
    </span>
  );
}

function SideBadge({ side }) {
  const buy = side === 'BUY';
  return (
    <span className={`badge ${buy ? 'badge-buy' : 'badge-sell'}`} style={{ fontSize:10 }}>{side}</span>
  );
}

const COLS = [
  { key:'symbol',     label:'Symbol' },
  { key:'side',       label:'Side' },
  { key:'entryDate',  label:'Entry' },
  { key:'exitDate',   label:'Exit' },
  { key:'entryPrice', label:'Entry ₹' },
  { key:'exitPrice',  label:'Exit ₹' },
  { key:'pnlPct',     label:'P&L %' },
  { key:'pnlAmount',  label:'P&L ₹' },
];

function fmt(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'; }
function price(v) { return v != null ? `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 })}` : '—'; }

export default function TradesTable({ trades = [], loading = false }) {
  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, padding:8 }}>
      {[...Array(5)].map((_,i) => <div key={i} className="skeleton" style={{ height:36 }} />)}
    </div>
  );

  if (!trades.length) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'48px 0', gap:8 }}>
      <div style={{ width:44, height:44, borderRadius:12, background:'var(--bg-elevated)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <ArrowUpRight size={18} style={{ color:'var(--text-muted)' }} />
      </div>
      <p className="font-mono" style={{ fontSize:11, color:'var(--text-muted)' }}>No trades yet</p>
      <p style={{ fontSize:11, color:'var(--text-muted)' }}>Run a backtest to populate trade history</p>
    </div>
  );

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            {COLS.map(c => (
              <th key={c.key} style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontFamily:'var(--font-mono)', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => {
            const pnl = t.pnlAmount ?? t.pnl_amount ?? 0;
            return (
              <tr key={i} className="trade-row" style={{ borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding:'10px 12px', fontSize:12, fontWeight:700, color:'var(--text-primary)', fontFamily:'var(--font-mono)' }}>
                  {t.symbol || t.Symbol || '—'}
                </td>
                <td style={{ padding:'10px 12px' }}><SideBadge side={t.side || t.Side || 'BUY'} /></td>
                <td style={{ padding:'10px 12px', fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-secondary)' }}>{fmt(t.entryDate || t.entry_date)}</td>
                <td style={{ padding:'10px 12px', fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-secondary)' }}>{fmt(t.exitDate || t.exit_date)}</td>
                <td style={{ padding:'10px 12px', fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-primary)' }}>{price(t.entryPrice || t.entry_price)}</td>
                <td style={{ padding:'10px 12px', fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text-primary)' }}>{price(t.exitPrice || t.exit_price)}</td>
                <td style={{ padding:'10px 12px' }}><PnlCell pnl={t.pnlPct ?? t.pnl_pct ?? t.returnPct} /></td>
                <td style={{ padding:'10px 12px', fontSize:11, fontFamily:'var(--font-mono)', fontWeight:600, color: pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {pnl ? `${pnl >= 0 ? '+' : ''}₹${Number(pnl).toLocaleString('en-IN', { maximumFractionDigits:0 })}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
