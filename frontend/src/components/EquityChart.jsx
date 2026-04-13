import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8, fontSize: 11,
      background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
      color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Bar #{label}</div>
      <div style={{ color: 'var(--cyan)' }}>
        ₹{Number(payload[0].value).toLocaleString('en-IN')}
      </div>
    </div>
  );
}

export default function EquityChart({ data = [], initialCapital = 1000000, height = 260 }) {
  if (!data.length) return <ChartSkeleton height={height} />;

  const chartData   = data.map((v, i) => ({ i, value: v }));
  const min         = Math.min(...data);
  const max         = Math.max(...data);
  const isProfit    = data[data.length - 1] >= initialCapital;
  const stroke      = isProfit ? 'var(--green)' : 'var(--red)';
  const gradientId  = isProfit ? 'eqGreenGrad' : 'eqRedGrad';

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={stroke} stopOpacity={0.25} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
          <XAxis dataKey="i" tick={false} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis
            domain={[min * 0.99, max * 1.01]}
            tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={initialCapital} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <Area
            type="monotone" dataKey="value"
            stroke={stroke} strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: stroke, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartSkeleton({ height = 260 }) {
  return (
    <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <div className="skeleton" style={{ width: 180, height: 4 }} />
      <div className="skeleton" style={{ width: 120, height: 4 }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', marginTop: 8 }}>
        Run a backtest to see equity curve
      </p>
    </div>
  );
}