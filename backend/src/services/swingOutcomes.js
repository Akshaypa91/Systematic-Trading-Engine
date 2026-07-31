// src/services/swingOutcomes.js
// ─────────────────────────────────────────────────────────────────────────────
// Did the swing signals actually work?
//
// Every signal in swing_signals carries entry / SL / T1 / T2. This module walks
// the REAL daily bars that came after each signal and records what happened, so
// the scanner can be scored instead of admired.
//
// Two decisions here matter more than the code:
//
// 1. SAME-BAR AMBIGUITY. A daily bar has a high and a low but no ordering. When
//    one bar's high >= T1 and its low <= SL, we cannot know which came first,
//    and assuming the target is exactly how backtests manufacture edges that
//    vanish live. We always assume the STOP hit first. Pessimistic, and honest.
//
// 2. WIN RATE ALONE IS MEANINGLESS. These signals have R:R below 1 (a ₹100 risk
//    chasing ₹61–78 of reward), so a 60% win rate can still lose money. Every
//    outcome therefore stores an R-MULTIPLE, and the aggregate reports
//    expectancy in R alongside the breakeven win rate implied by the actual
//    reward:risk. Win rate without those two numbers is decoration.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const axios  = require('axios');
const db     = require('../config/database');
const logger = require('../config/logger');

// Swing trades are not investments — a breakout that has done nothing in six
// weeks has failed, whatever the price is doing.
const HORIZON_BARS = 30;

// ── Outcome resolution (pure — no I/O, fully unit-testable) ──────────────────

/**
 * Walk bars after entry and classify the trade.
 *
 * @param {{entry:number, sl:number, t1:number}} sig
 * @param {Array<{date:string, high:number, low:number, close:number}>} bars
 *        Daily bars STRICTLY AFTER the signal date, chronological.
 * @param {number} [horizon=HORIZON_BARS]
 * @returns {{outcome:'TARGET'|'STOPPED'|'EXPIRED'|'OPEN', exitPrice:number|null,
 *            exitDate:string|null, rMultiple:number|null, barsHeld:number}}
 */
function resolveOutcome(sig, bars, horizon = HORIZON_BARS) {
  const entry = Number(sig.entry);
  const sl    = Number(sig.sl);
  const t1    = Number(sig.t1);
  const risk  = entry - sl;

  // A non-positive risk means a malformed signal (stop at or above entry).
  // R-multiples would be meaningless, so refuse rather than emit a number.
  if (!(risk > 0) || !Number.isFinite(entry) || !Number.isFinite(t1)) {
    return { outcome: 'OPEN', exitPrice: null, exitDate: null, rMultiple: null, barsHeld: 0 };
  }

  const window = bars.slice(0, horizon);

  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    const hitTarget = Number(b.high) >= t1;
    const hitStop   = Number(b.low)  <= sl;

    // Both in one bar → assume the stop. See note 1 at the top of this file.
    if (hitStop) {
      return { outcome: 'STOPPED', exitPrice: sl, exitDate: b.date, rMultiple: -1, barsHeld: i + 1 };
    }
    if (hitTarget) {
      return {
        outcome: 'TARGET', exitPrice: t1, exitDate: b.date,
        rMultiple: +((t1 - entry) / risk).toFixed(3), barsHeld: i + 1,
      };
    }
  }

  // Ran out of horizon → mark to the last close. This is a real result, not a
  // "still working" trade, and it usually sits between 0 and -1R.
  if (window.length >= horizon) {
    const last = window[window.length - 1];
    return {
      outcome: 'EXPIRED', exitPrice: Number(last.close), exitDate: last.date,
      rMultiple: +((Number(last.close) - entry) / risk).toFixed(3), barsHeld: window.length,
    };
  }

  // Not enough bars have printed yet — genuinely undecided. Must be excluded
  // from win rate rather than quietly counted as a loss.
  return { outcome: 'OPEN', exitPrice: null, exitDate: null, rMultiple: null, barsHeld: window.length };
}

/**
 * Aggregate resolved outcomes into monthly and overall performance.
 * Open trades are counted and reported, but never scored.
 */
/**
 * YYYY-MM from a value that may be a JS Date or a string.
 *
 * mysql2 hydrates DATE columns into Date objects, so String(row.signal_date)
 * gives "Thu Jul 30 2026 …" and slicing 7 chars off that yields "Thu Jul" —
 * which reached the UI as "Invalid Date". Normalise explicitly instead of
 * assuming the driver hands back an ISO string.
 */
function _monthOf(v) {
  if (v instanceof Date && !isNaN(v)) {
    // Local parts, not toISOString(): a date-only value at IST midnight shifts
    // to the previous day in UTC, which would misfile month boundaries.
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  }
  const s = String(v ?? '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(s);
  return isNaN(d) ? 'unknown' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM-DD from a Date or string — same driver caveat as _monthOf. */
function _dayOf(v) {
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v ?? '').slice(0, 10);
}

function summarise(rows) {
  const byMonth = new Map();

  const blank = (month) => ({
    month, signals: 0, open: 0, unscored: 0, decided: 0,
    wins: 0, losses: 0, expired: 0,
    winRatePct: null, avgR: null, totalR: 0,
    breakevenWinRatePct: null, _rrSum: 0, _rrN: 0,
  });

  for (const r of rows) {
    const month = _monthOf(r.signal_date);
    if (!byMonth.has(month)) byMonth.set(month, blank(month));
    const m = byMonth.get(month);
    m.signals++;

    // Reward:risk as PLANNED — this is what sets the bar the win rate must clear.
    const entry = Number(r.entry), sl = Number(r.sl), t1 = Number(r.t1);
    if (entry > sl && Number.isFinite(t1)) {
      m._rrSum += (t1 - entry) / (entry - sl);
      m._rrN++;
    }

    // "Never scored" and "scored, still undecided" are different states. Lumping
    // them together showed 17 signals as though 17 trades were running, when in
    // fact none had been checked against prices yet.
    if (!r.outcome)           { m.unscored++; continue; }
    if (r.outcome === 'OPEN') { m.open++;     continue; }
    m.decided++;
    m.totalR += Number(r.r_multiple) || 0;
    if (r.outcome === 'TARGET')       m.wins++;
    else if (r.outcome === 'STOPPED') m.losses++;
    else if (r.outcome === 'EXPIRED') { m.expired++; if ((Number(r.r_multiple) || 0) > 0) m.wins++; else m.losses++; }
  }

  const months = [...byMonth.values()].map(m => {
    if (m.decided > 0) {
      m.winRatePct = +((m.wins / m.decided) * 100).toFixed(1);
      m.avgR       = +(m.totalR / m.decided).toFixed(3);
      m.totalR     = +m.totalR.toFixed(2);
    }
    if (m._rrN > 0) {
      const rr = m._rrSum / m._rrN;
      m.avgRR = +rr.toFixed(2);
      // Break-even win rate for a payoff of `rr`: w·rr = (1−w)·1  →  w = 1/(1+rr)
      m.breakevenWinRatePct = +((1 / (1 + rr)) * 100).toFixed(1);
    }
    delete m._rrSum; delete m._rrN;
    return m;
  }).sort((a, b) => b.month.localeCompare(a.month));

  // Overall = sum of parts, recomputed (never averaged from monthly averages).
  const all = months.reduce((a, m) => {
    a.signals += m.signals; a.open += m.open; a.unscored += m.unscored; a.decided += m.decided;
    a.wins += m.wins; a.losses += m.losses; a.expired += m.expired;
    a.totalR += m.totalR || 0;
    return a;
  }, { signals: 0, open: 0, unscored: 0, decided: 0, wins: 0, losses: 0, expired: 0, totalR: 0 });

  all.totalR = +all.totalR.toFixed(2);
  if (all.decided > 0) {
    all.winRatePct = +((all.wins / all.decided) * 100).toFixed(1);
    all.avgR       = +(all.totalR / all.decided).toFixed(3);
  } else { all.winRatePct = null; all.avgR = null; }

  const rrMonths = months.filter(m => m.avgRR != null);
  if (rrMonths.length) {
    const rr = rrMonths.reduce((s, m) => s + m.avgRR * m.signals, 0)
             / rrMonths.reduce((s, m) => s + m.signals, 0);
    all.avgRR = +rr.toFixed(2);
    all.breakevenWinRatePct = +((1 / (1 + rr)) * 100).toFixed(1);
  }

  // Sample-size honesty. Below ~30 decided trades a win rate is noise, and
  // saying so is more useful than printing it with a decimal point.
  all.reliable = all.decided >= 30;
  all.verdict = all.signals === 0
    ? 'No signals recorded yet — nothing to score.'
    : all.decided === 0
    ? (all.unscored > 0
        ? `${all.unscored} signal${all.unscored === 1 ? '' : 's'} not scored yet — run Re-score to check them against real prices.`
        : `${all.open} signal${all.open === 1 ? '' : 's'} still within the ${HORIZON_BARS}-session window — no outcome to report yet.`)
    : !all.reliable
      ? `Only ${all.decided} resolved trades — too few to conclude anything. Treat this as a sanity check, not a result.`
      : all.avgR > 0
        ? `Positive expectancy: ${all.avgR}R per trade over ${all.decided} trades.`
        : `Negative expectancy: ${all.avgR}R per trade. A ${all.winRatePct}% win rate does not cover a ${all.avgRR}:1 payoff — breakeven needs ${all.breakevenWinRatePct}%.`;

  return { months, overall: all, horizonBars: HORIZON_BARS };
}

// ── Price source ─────────────────────────────────────────────────────────────
// Yahoo daily bars: no broker session required, so performance can be scored
// even when Upstox is disconnected. Swing signals are daily-resolution anyway.

const _barCache = new Map();   // symbol → { at, bars }
const BAR_TTL_MS = 30 * 60 * 1000;

async function fetchDailyBars(symbol) {
  const hit = _barCache.get(symbol);
  if (hit && Date.now() - hit.at < BAR_TTL_MS) return hit.bars;

  const to   = Math.floor(Date.now() / 1000);
  const from = to - 400 * 24 * 60 * 60;
  const res  = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS`, {
    params:  { period1: from, period2: to, interval: '1d', events: 'history' },
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    timeout: 15000,
  });
  const r = res.data?.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const q  = r?.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue;                       // Yahoo pads holidays with nulls
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      high: Number(q.high?.[i] ?? c), low: Number(q.low?.[i] ?? c), close: Number(c),
    });
  }
  _barCache.set(symbol, { at: Date.now(), bars });
  return bars;
}

// ── Persistence ──────────────────────────────────────────────────────────────

let _migrated = false;
async function ensureColumns() {
  if (_migrated) return;
  const alters = [
    `ALTER TABLE swing_signals ADD COLUMN IF NOT EXISTS outcome VARCHAR(10)`,
    `ALTER TABLE swing_signals ADD COLUMN IF NOT EXISTS exit_price DECIMAL(14,2)`,
    `ALTER TABLE swing_signals ADD COLUMN IF NOT EXISTS exit_date DATE`,
    `ALTER TABLE swing_signals ADD COLUMN IF NOT EXISTS r_multiple DECIMAL(8,3)`,
    `ALTER TABLE swing_signals ADD COLUMN IF NOT EXISTS bars_held INT`,
    `ALTER TABLE swing_signals ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMP NULL`,
  ];
  for (const sql of alters) {
    try { await db.query(sql); } catch (e) { logger.debug(`[SwingOutcomes] ${e.message}`); }
  }
  _migrated = true;
}

/**
 * Score every signal that is unresolved or still open. Re-checking OPEN rows is
 * the point: yesterday's undecided trade becomes today's win or loss.
 */
async function evaluatePending({ limit = 200 } = {}) {
  await ensureColumns();
  const [rows] = await db.query(
    `SELECT id, signal_date, symbol, entry, sl, t1
       FROM swing_signals
      WHERE outcome IS NULL OR outcome = 'OPEN'
      ORDER BY signal_date DESC
      LIMIT ?`, [Math.min(Number(limit) || 200, 500)]
  );

  let resolved = 0, checked = 0, failed = 0;
  for (const r of rows) {
    try {
      const bars  = await fetchDailyBars(r.symbol);
      const after = bars.filter(b => b.date > _dayOf(r.signal_date));
      const out   = resolveOutcome(r, after);
      await db.query(
        `UPDATE swing_signals
            SET outcome = ?, exit_price = ?, exit_date = ?, r_multiple = ?, bars_held = ?, evaluated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [out.outcome, out.exitPrice, out.exitDate, out.rMultiple, out.barsHeld, r.id]
      );
      checked++;
      if (out.outcome !== 'OPEN') resolved++;
      await new Promise(res => setTimeout(res, 250));   // stay polite with Yahoo
    } catch (e) {
      failed++;
      logger.debug(`[SwingOutcomes] ${r.symbol}: ${e.message}`);
    }
  }
  logger.info(`[SwingOutcomes] checked=${checked} resolved=${resolved} failed=${failed}`);
  return { checked, resolved, failed };
}

/** Monthly + overall performance over the recorded signals. */
async function getPerformance() {
  await ensureColumns();
  const [rows] = await db.query(
    `SELECT signal_date, symbol, entry, sl, t1, outcome, r_multiple, exit_date
       FROM swing_signals ORDER BY signal_date DESC LIMIT 1000`
  );
  return summarise(rows);
}

module.exports = { resolveOutcome, summarise, evaluatePending, getPerformance, HORIZON_BARS };
