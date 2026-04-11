import { useRef, useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="font-mono" style={{ padding:'8px 12px', background:'var(--bg-elevated)', border:'1px solid var(--border-bright)', borderRadius:8, fontSize:11 }}>
      <div style={{ color:'var(--text-muted)', marginBottom:2 }}>{payload[0].payload.t}</div>
      <div style={{ color:'var(--cyan)', fontWeight:600 }}>₹{(payload[0].value * 1000).toLocaleString('en-IN', { maximumFractionDigits:0 })}</div>
    </div>
  );
}

export default function LiveEquityChart({ data = [], initialCapital = 1000000, height = 220 }) {
  const prevLen = useRef(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (data.length > prevLen.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      prevLen.current = data.length;
      return () => clearTimeout(t);
    }
  }, [data.length]);

  if (data.length < 2) return (
    <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
      <div className="skeleton" style={{ width:160, height:4 }} />
      <p className="font-mono" style={{ fontSize:10, color:'var(--text-muted)', marginTop:8 }}>Collecting live equity data…</p>
    </div>
  );

  const values   = data.map(d => d.equity);
  const isProfit = values[values.length - 1] >= (initialCapital / 1000);
  const stroke   = isProfit ? 'var(--green)' : 'var(--red)';
  const min      = Math.min(...values) * 0.998;
  const max      = Math.max(...values) * 1.002;

  return (
    <div style={{ position:'relative' }}>
      {flash && (
        <div style={{ position:'absolute', top:0, right:0, width:6, height:6, borderRadius:'50%',
          background:'var(--cyan)', zIndex:10, animation:'equityPop 0.6s ease-out' }} />
      )}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top:4, right:4, bottom:0, left:4 }}>
          <defs>
            <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={stroke} stopOpacity={0.2} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="t"
            tick={{ fill:'var(--text-muted)', fontSize:9, fontFamily:'var(--font-mono)' }}
            interval={Math.max(1, Math.floor(data.length / 6))}
            tickLine={false} axisLine={false} />
          <YAxis domain={[min, max]}
            tick={{ fill:'var(--text-muted)', fontSize:9, fontFamily:'var(--font-mono)' }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `₹${v}K`} width={52} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={initialCapital / 1000} stroke="rgba(255,255,255,0.10)" strokeDasharray="4 4" />
          <Area type="monotone" dataKey="equity" stroke={stroke} strokeWidth={1.8}
            fill="url(#liveGrad)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
