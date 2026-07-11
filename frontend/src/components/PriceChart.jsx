// src/components/PriceChart.jsx
// Native price chart from Upstox candle data (GET /api/data/candles). Two views:
//   • Candles — self-contained measured SVG (reliable, real OHLC candlesticks)
//   • Line    — recharts area chart
// Every price comes from Upstox; the live LTP overlays as a dashed reference.
import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BarChart3, CandlestickChart, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
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

// ── Candlestick chart (measured SVG) ──────────────────────────────────────────
function Candlesticks({ candles, height, ltp, fmtLabel }) {
  const ref = useRef(null);
  const [w, setW] = useState(760);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(es => { for (const e of es) setW(Math.max(120, e.contentRect.width)); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const PAD = { l: 56, r: 12, t: 10, b: 22 };
    const plotW = Math.max(10, w - PAD.l - PAD.r);
    const plotH = Math.max(10, height - PAD.t - PAD.b);
    if (!candles.length) return null;
    let pmin = Math.min(...candles.map(c => c.l));
    let pmax = Math.max(...candles.map(c => c.h));
    const pad = (pmax - pmin) * 0.06 || 1; pmin -= pad; pmax += pad;
    const yOf = p => PAD.t + (pmax - p) / (pmax - pmin) * plotH;
    const n = candles.length;
    const step = plotW / n;
    const bodyW = Math.max(1, Math.min(step * 0.64, 12));
    const xOf = i => PAD.l + step * (i + 0.5);
    return { PAD, plotW, plotH, pmin, pmax, yOf, step, bodyW, xOf, n };
  }, [candles, w, height]);

  if (!geom) return null;
  const { PAD, pmin, pmax, yOf, step, bodyW, xOf, n } = geom;

  const yTicks = Array.from({ length: 5 }, (_, k) => pmin + (pmax - pmin) * k / 4);
  const xEvery = Math.max(1, Math.ceil(n / 6));

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = Math.round((mx - PAD.l) / step - 0.5);
    if (i >= 0 && i < n) setHover({ i, x: xOf(i), mx });
    else setHover(null);
  }

  const hc = hover ? candles[hover.i] : null;

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {/* Y grid + labels */}
        {yTicks.map((v, k) => (
          <g key={k}>
            <line x1={PAD.l} x2={w - PAD.r} y1={yOf(v)} y2={yOf(v)} stroke="var(--border)" strokeOpacity={0.4} />
            <text x={PAD.l - 6} y={yOf(v) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-mono)">₹{v.toFixed(2)}</text>
          </g>
        ))}
        {/* X labels */}
        {candles.map((c, i) => (i % xEvery === 0 ? (
          <text key={i} x={xOf(i)} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-mono)">{fmtLabel(c.t)}</text>
        ) : null))}
        {/* LTP reference */}
        {ltp != null && ltp >= pmin && ltp <= pmax && (
          <line x1={PAD.l} x2={w - PAD.r} y1={yOf(ltp)} y2={yOf(ltp)} stroke={GREEN} strokeDasharray="3 3" strokeOpacity={0.6} />
        )}
        {/* Candles */}
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const color = up ? GREEN : RED;
          const cx = xOf(i);
          const top = Math.min(yOf(c.o), yOf(c.c));
          const h = Math.max(1, Math.abs(yOf(c.o) - yOf(c.c)));
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={yOf(c.h)} y2={yOf(c.l)} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={h} fill={color} />
            </g>
          );
        })}
        {/* Hover crosshair */}
        {hover && <line x1={hover.x} x2={hover.x} y1={PAD.t} y2={height - PAD.b} stroke="var(--text-muted)" strokeOpacity={0.4} strokeDasharray="2 2" />}
      </svg>

      {hc && (
        <div style={{ position: 'absolute', top: 6, left: hover.mx > w / 2 ? 60 : 'auto', right: hover.mx > w / 2 ? 'auto' : 12,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, pointerEvents: 'none' }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>{fmtLabel(hc.t)}</div>
          {[['O', hc.o], ['H', hc.h], ['L', hc.l], ['C', hc.c]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: hc.c >= hc.o ? GREEN : RED }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}</span><span>{money(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PriceChart({ symbol, height = 320 }) {
  const [interval, setInterval_] = useState('day');
  const [chartType, setChartType] = useState('candle');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsH, setFsH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight - 130 : 600));
  const live = useLivePrice(symbol);

  // Fullscreen: lock body scroll, exit on Escape, track viewport height.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    const onResize = () => setFsH(window.innerHeight - 130);
    onResize();
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [fullscreen]);

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

  const fmtLabel = (t) => new Date(t).toLocaleString('en-IN', { hour12: false, month: 'short', day: '2-digit', hour: interval === 'day' || interval === 'week' ? undefined : '2-digit', minute: interval === 'day' || interval === 'week' ? undefined : '2-digit' });

  const areaData = candles.map(c => ({ t: fmtLabel(c.t), close: c.c }));

  const lastClose = candles.length ? candles[candles.length - 1].c : null;
  const ltp = live.isLive ? live.price : lastClose;
  const first = candles.length ? candles[0].c : null;
  const up = ltp != null && first != null ? ltp >= first : true;
  const lineColor = up ? GREEN : RED;

  const chartH = fullscreen ? fsH : height;

  const card = (
    <div className="card" style={{ padding: 14, ...(fullscreen ? { height: '100%', display: 'flex', flexDirection: 'column' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <BarChart3 size={15} style={{ color: 'var(--cyan)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{symbol}</span>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: lineColor }}>{money(ltp)}</span>
        {live.isLive && <span style={{ fontSize: 9, fontWeight: 700, color: GREEN, border: '1px solid color-mix(in srgb, var(--green) 34%, transparent)', borderRadius: 99, padding: '1px 7px', fontFamily: 'var(--font-mono)' }}>LIVE</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
          <div style={{ display: 'flex', gap: 4 }}>
            {INTERVALS.map(i => (
              <button key={i.key} onClick={() => setInterval_(i.key)}
                style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                  background: interval === i.key ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--bg-elevated)',
                  border: `1px solid ${interval === i.key ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'var(--border)'}`,
                  color: interval === i.key ? 'var(--cyan)' : 'var(--text-muted)' }}>{i.label}</button>
            ))}
          </div>
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Open chart fullscreen'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
              background: fullscreen ? 'color-mix(in srgb, var(--cyan) 14%, transparent)' : 'var(--bg-elevated)',
              border: `1px solid ${fullscreen ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'var(--border)'}`,
              color: fullscreen ? 'var(--cyan)' : 'var(--text-muted)', flexShrink: 0 }}>
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      <div style={{ height: chartH }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <RefreshCw size={14} className="animate-spin" /> Loading chart…
          </div>
        ) : candles.length ? (
          chartType === 'candle' ? (
            <Candlesticks candles={candles} height={chartH} ltp={ltp} fmtLabel={fmtLabel} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={areaData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
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
          )
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

  // Fullscreen: portal to <body> (escapes transformed/filtered ancestors),
  // full-viewport dark surface, Esc or the toolbar button to exit.
  if (fullscreen) {
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 9960, background: 'var(--bg-base)', padding: 12, display: 'flex', flexDirection: 'column' }}>
        {card}
      </div>,
      document.body
    );
  }

  return card;
}
