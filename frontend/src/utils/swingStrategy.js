// src/utils/swingStrategy.js
// "Fresh 52wk Breakout" swing strategy — by Akshay Pagare (Investors Way).
// Pure client-side evaluation over daily OHLCV candles from /api/data/candles.
// Mirrors the TradingView Pine script 1:1 (plus the Chartink ATR band filter):
//
//   trend_ok    close > sma200 && close > sma50 && sma50 > sma200
//   fresh_break close >= prior 252-bar high && yesterday closed below it
//   vol_ok      volume > 2.0 × sma(volume, 50)
//   move_ok     close > prev close × 1.005
//   liq_ok      volume × close > ₹2 Cr
//   price_ok    close > ₹50
//   atr_band    1.5% ≤ ATR(14)/close ≤ 5%          (Chartink filter)
//
//   entry = close × 1.001            sl = max(low, lowest(low,5)) × 0.995
//   t1 = entry + 1.5×ATR (sell 50%)  t2 = entry + 3×ATR (sell 50%)
//   qty = floor(capital × risk% / (entry − sl))
//
// Exits: 2 consecutive closes below 10-EMA, or 15-trading-day time stop.

const last = (a) => a[a.length - 1];

export function sma(values, len, offset = 0) {
  const end = values.length - offset;
  if (end < len) return null;
  let s = 0;
  for (let i = end - len; i < end; i++) s += values[i];
  return s / len;
}

export function ema(values, len) {
  if (values.length < len) return null;
  const k = 2 / (len + 1);
  let e = sma(values.slice(0, len), len);
  const out = new Array(values.length).fill(null);
  out[len - 1] = e;
  for (let i = len; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function atr14(candles, len = 14) {
  if (candles.length < len + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  // Wilder's smoothing (matches ta.atr)
  let a = sma(trs.slice(0, len), len);
  for (let i = len; i < trs.length; i++) a = (a * (len - 1) + trs[i]) / len;
  return a;
}

function highest(values, len, offset = 0) {
  const end = values.length - offset;
  const start = Math.max(0, end - len);
  if (end <= start) return null;
  let m = -Infinity;
  for (let i = start; i < end; i++) if (values[i] > m) m = values[i];
  return m;
}

function lowest(values, len, offset = 0) {
  const end = values.length - offset;
  const start = Math.max(0, end - len);
  if (end <= start) return null;
  let m = Infinity;
  for (let i = start; i < end; i++) if (values[i] < m) m = values[i];
  return m;
}

/**
 * Evaluate the strategy on daily candles ({t,o,h,l,c,v}[], oldest→newest).
 * Returns { ok, reason } on insufficient data, otherwise the full report.
 */
export function evaluateSwing(candles, { capital = 200000, riskPct = 1 } = {}) {
  if (!Array.isArray(candles) || candles.length < 210) {
    return { ok: false, reason: `Need ≥210 daily candles for SMA-200 (got ${candles?.length ?? 0})` };
  }

  const closes = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);
  const lows   = candles.map(c => c.l);
  const vols   = candles.map(c => c.v ?? 0);

  const close = last(closes);
  const prevClose = closes[closes.length - 2];
  const low = last(lows);
  const volume = last(vols);

  const sma50   = sma(closes, 50);
  const sma200  = sma(closes, 200);
  const sma50p5 = sma(closes, 50, 5);
  const sma200p5 = sma(closes, 200, 5);
  const volSma50 = sma(vols, 50);
  const atr = atr14(candles);

  // 52-week high of the PRIOR bar window (high_52[1] in Pine)
  const lookback = Math.min(252, candles.length - 1);
  const high52Prev = highest(highs, lookback, 1);

  const ema10Arr = ema(closes, 10);
  const e10 = last(ema10Arr);
  const e10p = ema10Arr[ema10Arr.length - 2];

  const atrPct = atr != null ? atr / close : null;

  const checks = [
    { key: 'price',  label: 'Price > ₹50',                       pass: close > 50,
      detail: `₹${close.toFixed(2)}` },
    { key: 'trend',  label: 'Uptrend — close > 50/200 DMA, 50 > 200', pass: close > sma200 && close > sma50 && sma50 > sma200,
      detail: `50DMA ₹${sma50?.toFixed(1)} · 200DMA ₹${sma200?.toFixed(1)}` },
    { key: 'slope',  label: 'Rising DMAs (vs 5 days ago)',       pass: sma50 > sma50p5 && sma200 > sma200p5,
      detail: `Δ50: ${(sma50 - sma50p5).toFixed(2)} · Δ200: ${(sma200 - sma200p5).toFixed(2)}` },
    { key: 'fresh',  label: 'Fresh 52-week breakout',            pass: close >= high52Prev && prevClose < high52Prev,
      detail: `52wk high ₹${high52Prev?.toFixed(2)} · prev close ₹${prevClose.toFixed(2)}` },
    { key: 'vol',    label: 'Volume surge ≥ 2× 50-day avg',      pass: volSma50 != null && volume > volSma50 * 2,
      detail: `${(volume / 1e6).toFixed(2)}M vs avg ${(volSma50 / 1e6).toFixed(2)}M` },
    { key: 'move',   label: 'Up-move ≥ 0.5% today',              pass: close > prevClose * 1.005,
      detail: `${(((close / prevClose) - 1) * 100).toFixed(2)}%` },
    { key: 'liq',    label: 'Liquidity > ₹2 Cr traded',          pass: volume * close > 20000000,
      detail: `₹${((volume * close) / 1e7).toFixed(2)} Cr` },
    { key: 'atr',    label: 'ATR band 1.5–5% of price',          pass: atrPct != null && atrPct >= 0.015 && atrPct <= 0.05,
      detail: atrPct != null ? `${(atrPct * 100).toFixed(2)}%` : '—' },
  ];

  const breakout = checks.every(c => c.pass);
  const coreTrend = checks[1].pass && checks[2].pass;

  // Levels (computed regardless of verdict, so the trader can see the plan)
  const entry = close * 1.001;
  const sl = Math.max(low, lowest(lows, 5)) * 0.995;
  const slDist = entry - sl;
  const slPct = (slDist / entry) * 100;
  const t1 = entry + 1.5 * atr;
  const t2 = entry + 3.0 * atr;
  const rr1 = slDist > 0 ? (t1 - entry) / slDist : 0;
  const rr2 = slDist > 0 ? (t2 - entry) / slDist : 0;
  const qty = slDist > 0 ? Math.floor((capital * (riskPct / 100)) / slDist) : 0;
  const qtyHalf = Math.floor(qty / 2);

  const trailExit = close < e10 && prevClose < e10p;

  return {
    ok: true,
    verdict: breakout ? 'BREAKOUT' : coreTrend ? 'WATCHING' : 'NO_SETUP',
    checks,
    close, atr, atrPct, sma50, sma200, high52Prev,
    levels: { entry, sl, slPct, t1, t2, rr1, rr2, qty, qtyHalf, risk: capital * (riskPct / 100) },
    exits: { trailExit, ema10: e10, timeStopDays: 15 },
  };
}
