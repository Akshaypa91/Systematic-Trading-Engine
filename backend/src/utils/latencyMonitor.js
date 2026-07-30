// src/utils/latencyMonitor.js
// ─────────────────────────────────────────────────────────────────────────────
// Measures how fast this system ACTUALLY reacts, stage by stage, so claims about
// speed are numbers instead of guesses.
//
// The pipeline from a price change to an order at the exchange:
//
//   feed_age      how stale the quote already is when we read it
//   signal_calc   time to compute the strategy decision
//   order_place   broker API round trip for the order request
//   fill_confirm  time until the broker reports a fill
//   ─────────────────────────────────────────────────────────────
//   reaction      feed_age + signal_calc + order_place  (what matters)
//
// Reference points, so the numbers mean something:
//   colocated HFT   ~10–100 microseconds  (0.00001–0.0001 s)
//   fast retail algo   ~50–200 ms
//   this system         measure it and see
//
// Pure in-memory ring buffers; no I/O, no dependencies. Cheap enough to call on
// every tick.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const MAX_SAMPLES = parseInt(process.env.LATENCY_SAMPLES || '500', 10);

// stage → { samples: number[], count, sum, max, last }
const _stages = new Map();

function _stage(name) {
  let s = _stages.get(name);
  if (!s) { s = { samples: [], count: 0, sum: 0, max: 0, last: null, lastAt: null }; _stages.set(name, s); }
  return s;
}

/** Record a duration (ms) for a stage. */
function record(stage, ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return;
  const s = _stage(String(stage));
  s.samples.push(v);
  if (s.samples.length > MAX_SAMPLES) s.samples.shift();
  s.count++; s.sum += v;
  if (v > s.max) s.max = v;
  s.last = v; s.lastAt = Date.now();
}

/** Time an async fn and record it. Returns whatever fn returns. */
async function time(stage, fn) {
  const t0 = process.hrtime.bigint();
  try { return await fn(); }
  finally { record(stage, Number(process.hrtime.bigint() - t0) / 1e6); }
}

/** Synchronous variant. */
function timeSync(stage, fn) {
  const t0 = process.hrtime.bigint();
  try { return fn(); }
  finally { record(stage, Number(process.hrtime.bigint() - t0) / 1e6); }
}

function _pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return +sorted[i].toFixed(2);
}

function statsFor(name) {
  const s = _stages.get(name);
  if (!s || !s.samples.length) return null;
  const sorted = [...s.samples].sort((a, b) => a - b);
  return {
    stage: name,
    samples: s.samples.length,
    totalObserved: s.count,
    p50: _pct(sorted, 50), p95: _pct(sorted, 95), p99: _pct(sorted, 99),
    avg: +(s.sum / s.count).toFixed(2),
    max: +s.max.toFixed(2),
    last: s.last,
    lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
  };
}

// Human-scale comparison so a millisecond figure lands properly.
function _classify(reactionMs) {
  if (reactionMs == null) return 'unknown';
  if (reactionMs < 1)      return 'sub-millisecond (HFT territory — implausible for a retail REST stack)';
  if (reactionMs < 50)     return 'very fast for retail';
  if (reactionMs < 250)    return 'typical fast retail algo';
  if (reactionMs < 1000)   return 'slow — sub-second but not competitive';
  return 'seconds-scale — suitable for swing/positional only, NOT scalping';
}

/** Full report incl. the composed reaction budget. */
function report() {
  const stages = {};
  for (const name of _stages.keys()) stages[name] = statsFor(name);

  const p = (n) => stages[n]?.p50 ?? null;
  const parts = { feed_age: p('feed_age'), signal_calc: p('signal_calc'), order_place: p('order_place') };
  const known = Object.values(parts).filter(v => v != null);
  const reaction = known.length ? +known.reduce((a, b) => a + b, 0).toFixed(2) : null;

  return {
    stages,
    reaction: {
      breakdown: parts,
      totalMs: reaction,
      // Microseconds purely to make the HFT comparison explicit.
      totalMicroseconds: reaction != null ? Math.round(reaction * 1000) : null,
      classification: _classify(reaction),
      hftReferenceMicroseconds: '10–100 (colocated, direct market access)',
      note: reaction != null
        ? `Median reaction ≈ ${reaction} ms ≈ ${Math.round(reaction * 1000)} µs. HFT operates at 10–100 µs, i.e. roughly ${reaction > 0 ? Math.round((reaction * 1000) / 50) : '—'}× faster than this system.`
        : 'Not enough samples yet — trade or poll during market hours to populate.',
    },
    sampleWindow: MAX_SAMPLES,
  };
}

function reset() { _stages.clear(); }

module.exports = { record, time, timeSync, statsFor, report, reset };
