// src/components/PriceChart.jsx
// Native price chart drawn from Upstox candle data (GET /api/data/candles).
// Replaces the TradingView embed so EVERY NSE symbol renders and every price
// comes from Upstox. Two views: Area (line) and Candlestick. Live LTP overlays.
import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, ComposedChart, Bar, Customized,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { BarChart3, CandlestickChart, RefreshCw } from 'lucide-react';
import { marketAPI } from '../services/api';
import useLivePrice from '../hooks/useLivePrice';

const INTERVALS = [
  { key: '30minute', label: '30m', days: 10 },
  { key: 'day',      label: '1D',  days: 180 },
  { key: 'week',     label: '1W',  days: 730 },
];

const money = (v) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const GREEN = 'var(--green)';
const RED   = 'var(--red)';

// Candlestick layer — draws wicks + bodies using recharts' resolved scales.
function CandleLayer({ xAxisMap, yAxisMap, data }) {
  if (!xAxisMap || !yAxisMap || !data?.length) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap[Object.keys(yAxisMap)[0]];
  const xScale = xAxis?.scale, yScale = yAxis?.scale;
  if (!xScale || !yScale) return null;
  const bw = xScale.bandwidth ? xScale.bandwidth() : 6;
  const bodyW = Math.max(1, Math.min(bw * 0.6, 10));

  return (
    <g>
      {data.map((d, i) => {
        const cx = xScale(d.t) + bw / 2;
        if (!isFinite(cx)) return null;
        const up = d.c >= d.o;
        const color = up ? GREEN : RED;
        const yO = yScale(d.o), yC = yScale(d.c), yH = yScale(d.h), yL = yScale(d.l);
        const top = Math.min(yO, yC);
        const h = Math.max(1, Math.abs(yO - yC));
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect x={cx - bodyW / 2} y={top} width={bodyW} height={h} fill={color} opacity={0.9} />
          </g>
        );
      })}
    </g>
  );
}

function CandleTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const up = d.c >= d.o;
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>{d.t}</div>
      {[['O', d.o], ['H', d.h], ['L', d.l], ['C', d.c]].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: up ? GREEN : RED }}>
          <span style={{ color: 'var(--text-muted)' }}>{k}</span><span>{money(v)}</span>
        </div>
      ))}
    </div>
  );
}

export default function PriceChart({ symbol, height = 320 }) {
  const [interval, setInterval_] = useState('day');
  const [chartType, setChartType] = useState('candle');   // 'area' | 'candle'
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const live = useLivePrice(symbol);

  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    const cfg = INTERVALS.find(i => i.key === interval) || INTERVALS[1];
    setLoading(true); setErr(null);
    marketAPI.getCandles(symbol, { interval, days: cfg.days })
      .then(r => { if (!alive) return; const c = r.data?.candles || []; setCandles(c); if (!c.length) setErr(r.data?.error || 'No chart data'); })
      .catch(e => { if (alive) setErr(e.response?.data?.error || 'Failed to load chart'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol, interval]);

  const data = useMemo(() => candles.map(c => ({
    t: new Date(c.t).toLocaleString('en-IN', { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    o: c.o, h: c.h, l: c.l, c: c.c, close: c.c,
  })), [candles]);

  const lastClose = candles.length ? candles[candles.length - 1].c : null;
  const ltp = live.isLive ? live.price : lastClose;
  const first = candles.length ? candles[0].c : null;
  const up = ltp != null && first != null ? ltp >= first : true;
  const lineColor = up ? GREEN : RED;

  // Candle mode needs a domain that spans whighs/lows.
  const yDomain = useMemo(() => {
    if (chartType !== 'candle' || !candles.length) return ['auto', 'auto'];
    const lo = Math.min(...candles.map(c => c.l));
    const hi = Math.max(...candles.map(c => c.h));
    const pad = (hi - lo) * 0.06 || 1;
    return [+(lo - pad).toFixed(2), +(hi + pad).toFixed(2)];
  }, [chartType, candles]);

  const axisProps = {
    x: { dataKey: 't', tick: { fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }, axisLine: false, tickLine: false, minTickGap: 48 },
    y: { domain: yDomain, tick: { fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }, axisLine: false, tickLine: false, width: 54, tickFormatter: v => `₹${v}` },
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <BarChart3 size={15} style={{ color: 'var(--cyan)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</span>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: lineColor }}>{money(ltp)}</span>
        {live.isLive && <span style={{ fontSize: 9, fontWeight: 700, color: GREEN, border: '1px solid color-mix(in srgb, var(--green) 34%, transparent)', borderRadius: 99, padding: '1px 7px', fontFamily: 'var(--font-mono)' }}>LIVE</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {/* chart type toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[['candle', CandlestickChart, 'Candles'], ['area', BarChart3, 'Line']].map(([key, Icon, label]) => (
              <button key={key} onClick={() => setChartType(key)} title={label}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                  background: chartType === key ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--bg-elevated)',
                  border: `1px solid ${chartType === key ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'var(--border)'}`,
                  color: chartType === key ? 'var(--cyan)' : 'var(--text-muted)' }}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          {/* interval toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {INTERVALS.map(i => (
              <button key={i.key} onClick={() => setInterval_(i.key)}
                style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                  background: interval === i.key ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--bg-elevated)',
                  border: `1px solid ${interval === i.key ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'var(--border)'}`,
                  color: interval === i.key ? 'var(--cyan)' : 'var(--text-muted)' }}>{i.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ height }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <RefreshCw size={14} className="animate-spin" /> Loading chart…
          </div>
        ) : data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'candle' ? (
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <XAxis {...axisProps.x} />
                <YAxis {...axisProps.y} />
                <Tooltip content={<CandleTooltip />} cursor={{ stroke: 'var(--border)' }} />
                {ltp != null && <ReferenceLine y={ltp} stroke={lineColor} strokeDasharray="3 3" strokeOpacity={0.6} />}
                <Bar dataKey="c" fill="transparent" isAnimationActive={false} />
                <Customized component={(p) => <CandleLayer {...p} data={data} />} />
              </ComposedChart>
            ) : (
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="pcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis {...axisProps.x} />
                <YAxis {...axisProps.y} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }} formatter={v => [money(v), 'Close']} />
                {ltp != null && <ReferenceLine y={ltp} stroke={lineColor} strokeDasharray="3 3" strokeOpacity={0.6} />}
                <Area type="monotone" dataKey="close" stroke={lineColor} strokeWidth={1.6} fill="url(#pcGrad)" isAnimationActive={false} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
            <BarChart3 size={22} style={{ opacity: 0.5 }} />
            <div style={{ fontSize: 12 }}>{err || 'No chart data for this symbol'}</div>
            <div style={{ fontSize: 10.5 }}>Live price {money(ltp)} — candles need a connected Upstox session.</div>
          </div>
        )}
      </div>
    </div>
  );
}
