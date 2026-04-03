import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="px-3 py-2 rounded-lg text-xs font-mono"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)' }}>
      <div style={{ color: 'var(--text-muted)' }}>Bar #{label}</div>
      <div style={{ color: 'var(--accent-cyan)' }}>₹{Number(v).toLocaleString('en-IN')}</div>
    </div>
  );
}

export default function EquityChart({ data = [], initialCapital = 1000000, height = 260 }) {
  if (!data.length) return <ChartSkeleton height={height} />;

  const chartData   = data.map((v, i) => ({ i, value: v }));
  const min         = Math.min(...data);
  const max         = Math.max(...data);
  const isProfit    = data[data.length - 1] >= initialCapital;
  const accentColor = isProfit ? 'var(--accent-green)' : 'var(--accent-red)';
  const gradientId  = isProfit ? 'eqGreenGrad' : 'eqRedGrad';

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={accentColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={accentColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
          <XAxis dataKey="i" tick={false} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis
            domain={[min * 0.99, max * 1.01]}
            tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={initialCapital} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <Area
            type="monotone" dataKey="value"
            stroke={accentColor} strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: accentColor, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartSkeleton({ height = 260 }) {
  return (
    <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="skeleton" style={{ width: 180, height: 4, borderRadius: 2, background: 'var(--border-bright)', margin: '0 auto 10px' }} />
        <div className="skeleton" style={{ width: 120, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'IBM Plex Mono', marginTop: 16 }}>
          Run a backtest to see equity curve
        </p>
      </div>
    </div>
  );
}