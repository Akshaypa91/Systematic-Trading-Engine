import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="px-3 py-2 rounded-lg text-xs font-mono"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)', color: 'var(--text-primary)' }}>
      <div style={{ color: 'var(--text-muted)' }}>Bar #{label}</div>
      <div style={{ color: 'var(--accent-cyan)' }}>₹{v?.toLocaleString('en-IN')}</div>
    </div>
  );
}

export default function EquityChart({ data = [], initialCapital = 1000000 }) {
  if (!data.length) return <ChartSkeleton />;

  const chartData = data.map((v, i) => ({ i, value: v }));
  const min = Math.min(...data);
  const max = Math.max(...data);
  const isProfit = data[data.length - 1] >= initialCapital;

  const accentColor = isProfit ? 'var(--accent-green)' : 'var(--accent-red)';
  const gradientId = isProfit ? 'greenGrad' : 'redGrad';

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={accentColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={accentColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="i"
            tick={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis
            domain={[min * 0.99, max * 1.01]}
            tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={initialCapital}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={accentColor}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: accentColor, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="text-center">
        <div className="w-48 h-1 rounded mx-auto mb-3 skeleton"
          style={{ background: 'var(--border-bright)' }} />
        <div className="w-32 h-1 rounded mx-auto skeleton"
          style={{ background: 'var(--border)' }} />
        <p className="text-xs mt-4 font-mono" style={{ color: 'var(--text-muted)' }}>
          Run a backtest to see equity curve
        </p>
      </div>
    </div>
  );
}
