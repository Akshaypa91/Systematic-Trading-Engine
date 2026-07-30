// src/strategies/intradayScalper.js
// ─────────────────────────────────────────────────────────────────────────────
// INTRADAY MEAN-REVERSION SCALPER on 1-minute bars.
//
// Thesis (the most documented intraday effect): within a session price
// oscillates around VWAP. Stretch away from VWAP tends to partially revert, so
// buy dislocations BELOW VWAP while the micro-trend is turning up, and target
// VWAP itself.
//
// ── The cost problem, stated honestly ────────────────────────────────────────
// Scalping's enemy is not signal quality, it's arithmetic. Every round trip pays
// brokerage + STT + exchange + GST + stamp duty + slippage. On NSE equity
// intraday that is roughly 10–25 bps. A scalp targeting 20 bps therefore keeps
// almost nothing, and India's 20% short-term capital-gains tax applies to
// whatever survives.
//
// So this module REFUSES to signal unless the expected move clears costs by a
// configured multiple (`minEdgeMultiple`). `requiredMoveBps` in the output makes
// the hurdle explicit. A "no trade" answer here is a correct answer.
//
// ── Reaction-time reality ────────────────────────────────────────────────────
// This system's measured median reaction is ~1–5 SECONDS (feed staleness
// dominates). On 1-minute bars that is 2–8% of a bar, which is survivable — but
// it is NOT scalping in the HFT sense and cannot chase sub-second moves.
//
// Long-only (retail cash intraday), always flat by the square-off time.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const P = {
  VWAP_STRETCH_ATR: parseFloat(process.env.SCALP_STRETCH_ATR || '1.2'),  // how far below VWAP to act
  EMA_FAST:         parseInt(process.env.SCALP_EMA_FAST || '9', 10),
  EMA_SLOW:         parseInt(process.env.SCALP_EMA_SLOW || '21', 10),
  ATR_WIN:          parseInt(process.env.SCALP_ATR_WIN || '14', 10),
  STOP_ATR:         parseFloat(process.env.SCALP_STOP_ATR || '1.0'),
  MIN_EDGE_MULT:    parseFloat(process.env.SCALP_MIN_EDGE_MULT || '2.0'), // target ≥ 2× costs
  ROUND_TRIP_BPS:   parseFloat(process.env.SCALP_ROUND_TRIP_BPS || '18'), // brokerage+STT+GST+slippage
  SQUARE_OFF_HHMM:  parseInt(process.env.SCALP_SQUARE_OFF || '1515', 10), // flat before 15:30
};

const _n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

// True-range ATR over OHLC bars.
function atr(bars, period) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const h = _n(bars[i].high), l = _n(bars[i].low), pc = _n(bars[i - 1].close);
    if (![h, l, pc].every(Number.isFinite)) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
}

// Session VWAP — resets each day, so only bars from the latest date count.
function sessionVwap(bars) {
  if (!bars.length) return null;
  const day = String(bars[bars.length - 1].date || bars[bars.length - 1].t || '').slice(0, 10);
  let pv = 0, vol = 0;
  for (const b of bars) {
    const d = String(b.date || b.t || '').slice(0, 10);
    if (d !== day) continue;
    const tp = (_n(b.high) + _n(b.low) + _n(b.close)) / 3;
    const v  = _n(b.volume) || 1;              // volume-less feeds → equal weight
    if (!Number.isFinite(tp)) continue;
    pv += tp * v; vol += v;
  }
  return vol > 0 ? pv / vol : null;
}

function hhmmOf(bar) {
  const raw = String(bar?.date || bar?.t || '');
  const m = raw.match(/T(\d{2}):(\d{2})/);
  return m ? parseInt(m[1] + m[2], 10) : null;
}

/**
 * @param {Array<{date,open,high,low,close,volume}>} bars ascending 1-minute bars
 * @param {object} [opts] { roundTripBps, minEdgeMultiple }
 * @returns {{signal, confidence, reason, vwap, atr, stretchAtr, targetBps, requiredMoveBps, stop, target, costViable}}
 */
function generateSignal(bars, opts = {}) {
  const need = Math.max(P.EMA_SLOW, P.ATR_WIN) + 2;
  if (!Array.isArray(bars) || bars.length < need) {
    return { signal: 'HOLD', confidence: 0, reason: `Insufficient bars (need ${need}, got ${bars?.length ?? 0})`,
      vwap: null, atr: null, stretchAtr: null, targetBps: null, requiredMoveBps: null, costViable: false };
  }

  const closes = bars.map(b => _n(b.close)).filter(Number.isFinite);
  const last   = bars[bars.length - 1];
  const price  = _n(last.close);
  const vwap   = sessionVwap(bars);
  const a      = atr(bars, P.ATR_WIN);
  const eFast  = ema(closes, P.EMA_FAST);
  const eSlow  = ema(closes, P.EMA_SLOW);

  const roundTripBps    = _n(opts.roundTripBps ?? P.ROUND_TRIP_BPS);
  const minEdgeMultiple = _n(opts.minEdgeMultiple ?? P.MIN_EDGE_MULT);
  const requiredMoveBps = +(roundTripBps * minEdgeMultiple).toFixed(2);

  const base = { vwap: vwap != null ? +vwap.toFixed(2) : null, atr: a != null ? +a.toFixed(4) : null,
    requiredMoveBps, currentPrice: price };

  if (!(price > 0) || vwap == null || a == null || eFast == null || eSlow == null) {
    return { ...base, signal: 'HOLD', confidence: 0, reason: 'Indicators unavailable', stretchAtr: null, targetBps: null, costViable: false };
  }

  // Flat before the close — intraday positions must not carry overnight.
  const t = hhmmOf(last);
  if (t != null && t >= P.SQUARE_OFF_HHMM) {
    return { ...base, signal: 'SELL', confidence: 1, reason: `Square-off window (${t} ≥ ${P.SQUARE_OFF_HHMM})`,
      stretchAtr: null, targetBps: null, costViable: true };
  }

  // Dislocation below VWAP, measured in ATRs.
  const stretchAtr = +((vwap - price) / a).toFixed(2);
  // Reverting to VWAP is the target; express it in bps to compare with costs.
  const targetBps  = +(((vwap - price) / price) * 10000).toFixed(2);
  const costViable = targetBps >= requiredMoveBps;

  let signal = 'HOLD', reason, confidence = 0;
  if (stretchAtr >= P.VWAP_STRETCH_ATR && eFast > eSlow && costViable) {
    signal = 'BUY';
    confidence = Math.max(0, Math.min(1, stretchAtr / (P.VWAP_STRETCH_ATR * 2)));
    reason = `${stretchAtr} ATR below VWAP, micro-trend up, target ${targetBps} bps ≥ required ${requiredMoveBps} bps`;
  } else if (price >= vwap) {
    signal = 'SELL';   // reverted to the anchor → take it
    confidence = 0.6;
    reason = 'Price reached VWAP — mean reversion complete';
  } else if (!costViable) {
    reason = `Move too small to pay for itself: target ${targetBps} bps < required ${requiredMoveBps} bps (costs ${roundTripBps} bps × ${minEdgeMultiple})`;
  } else if (stretchAtr < P.VWAP_STRETCH_ATR) {
    reason = `Only ${stretchAtr} ATR from VWAP — need ${P.VWAP_STRETCH_ATR}`;
  } else {
    reason = 'Micro-trend not confirmed (EMA fast below slow)';
  }

  return {
    ...base, signal, confidence: +confidence.toFixed(4), reason,
    stretchAtr, targetBps, costViable,
    stop:   +(price - P.STOP_ATR * a).toFixed(2),
    target: +vwap.toFixed(2),
  };
}

/** Break-even move (bps) for a round trip at a given cost assumption. */
function breakevenBps(roundTripBps = P.ROUND_TRIP_BPS) { return _n(roundTripBps); }

function describe() {
  return {
    name: 'INTRADAY_SCALPER',
    type: 'VWAP mean reversion on 1-minute bars (long-only, flat by square-off)',
    params: P,
    warning: 'High turnover. Costs + 20% STCG are certain; the edge is not. This system\'s measured reaction is seconds-scale.',
  };
}

module.exports = { generateSignal, describe, breakevenBps, PARAMS: P };
