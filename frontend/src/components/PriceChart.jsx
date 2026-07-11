// src/components/PriceChart.jsx
// Native price chart drawn from Upstox candle data (GET /api/data/candles).
// Replaces the TradingView embed so EVERY NSE symbol renders and every price
// comes from Upstox. The live LTP overlays the last candle.
import { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BarChart3, RefreshCw } from 'lucide-react';
import { marketAPI } from '../services/api';
import useLivePrice from '../hooks/useLivePrice';

const INTERVALS = [
  { key: '30minute', label: '30m', days: 10 },
  { key: 'day',      label: '1D',  days: 180 },
  { key: 'week',     label: '1W',  days: 730 },
];

const money = (v) => v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function PriceChart({ symbol, height = 320 }) {
  const [interval, setInterval_] = useState('day');
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
    close: c.c,
  })), [candles]);

  const lastClose = candles.length ? candles[candles.length - 1].c : null;
  const ltp = live.isLive ? live.price : lastClose;
  const first = candles.length ? candles[0].c : null;
  const up = ltp != null && first != null ? ltp >= first : true;
  const lineColor = up ? 'var(--green)' : 'var(--red)';

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <BarChart3 size={15} style={{ color: 'var(--cyan)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</span>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: lineColor }}>{money(ltp)}</span>
        {live.isLive && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--green)', border: '1px solid color-mix(in srgb, var(--green) 34%, transparent)', borderRadius: 99, padding: '1px 7px', fontFamily: 'var(--font-mono)' }}>LIVE</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {INTERVALS.map(i => (
            <button key={i.key} onClick={() => setInterval_(i.key)}
              style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                background: interval === i.key ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--bg-elevated)',
                border: `1px solid ${interval === i.key ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'var(--border)'}`,
                color: interval === i.key ? 'var(--cyan)' : 'var(--text-muted)' }}>{i.label}</button>
          ))}
        </div>
      </div>

      <div style={{ height }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <RefreshCw size={14} className="animate-spin" /> Loading chart…
          </div>
        ) : data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="pcGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} minTickGap={48} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} width={54} tickFormatter={v => `₹${v}`} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }} formatter={v => [money(v), 'Close']} />
              {ltp != null && <ReferenceLine y={ltp} stroke={lineColor} strokeDasharray="3 3" strokeOpacity={0.6} />}
              <Area type="monotone" dataKey="close" stroke={lineColor} strokeWidth={1.6} fill="url(#pcGrad)" isAnimationActive={false} />
            </AreaChart>
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
