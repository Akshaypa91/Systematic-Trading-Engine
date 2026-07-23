// src/data/corpActionLoader.js
// ─────────────────────────────────────────────────────────────────────────────
// Populates the corporate_actions table from NSE's corporate-actions feed so
// the adjustment engine (corporateActions.js) isn't limited to hand-seeded
// entries. The heavy lifting is `parsePurpose()` — a pure function that turns an
// NSE "subject" string into an adjustment factor. It's unit-tested offline
// because NSE often blocks server IPs; the network layer degrades gracefully.
//
//   Bonus a:b            -> factor b/(a+b)      (price multiplier for dates <= ex)
//   Split old_fv->new_fv -> factor new_fv/old_fv
//   Dividends / AGM / etc -> ignored (no price-split adjustment)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

// "28-Oct-2024" | "2024-10-28" -> "2024-10-28" (or null)
function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})/);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Parse an NSE corporate-action subject line into an adjustment record.
 * @param {string} subject
 * @returns {{action_type, numerator, denominator, factor, ratio_text}|null}
 */
function parsePurpose(subject) {
  if (!subject) return null;
  const s = String(subject).toLowerCase();

  // Bonus, e.g. "Bonus 1:1", "Bonus issue 2 : 1"
  let m = s.match(/bonus\D*(\d+)\s*:\s*(\d+)/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a > 0 && b > 0) {
      return { action_type: 'BONUS', numerator: a, denominator: b, factor: b / (a + b), ratio_text: `${a}:${b} bonus` };
    }
  }

  // Face-value split / sub-division, e.g.
  // "Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share"
  if (/split|sub-division|sub division|face value/.test(s)) {
    m = s.match(/from\s*(?:rs\.?\s*)?(\d+(?:\.\d+)?)\D*?to\s*(?:rs\.?\s*)?(\d+(?:\.\d+)?)/);
    if (m) {
      const oldFv = parseFloat(m[1]), newFv = parseFloat(m[2]);
      if (oldFv > 0 && newFv > 0 && newFv < oldFv) {
        return { action_type: 'SPLIT', numerator: newFv, denominator: oldFv, factor: newFv / oldFv, ratio_text: `split ₹${oldFv}→₹${newFv}` };
      }
    }
    // Split expressed as a ratio, e.g. "Stock Split 1:5"
    m = s.match(/split\D*(\d+)\s*:\s*(\d+)/);
    if (m) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > 0 && b > 0 && a !== b) {
        // 1:5 => one share becomes five => price /5 => factor min/max
        const factor = Math.min(a, b) / Math.max(a, b);
        return { action_type: 'SPLIT', numerator: Math.min(a, b), denominator: Math.max(a, b), factor, ratio_text: `${a}:${b} split` };
      }
    }
  }

  return null;  // dividend, AGM, buyback, etc. — no price-continuity adjustment
}

// Turn NSE's raw rows into normalized adjustment records (with ex_date).
function extractActions(rows) {
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const subject = r.subject || r.purpose || r.Purpose || '';
    const exRaw   = r.exDate || r.exdate || r.ExDate || r.ex_date;
    const ex_date = parseDate(exRaw);
    const parsed  = parsePurpose(subject);
    if (ex_date && parsed) out.push({ ex_date, ...parsed, subject });
  }
  return out;
}

async function upsertActions(symbol, actions) {
  const sym = String(symbol).toUpperCase();
  let n = 0;
  for (const a of actions) {
    try {
      await db.query(
        `INSERT INTO corporate_actions (symbol, exchange, ex_date, action_type, numerator, denominator, factor, ratio_text, notes)
         VALUES (?, 'NSE', ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE factor = VALUES(factor), numerator = VALUES(numerator),
           denominator = VALUES(denominator), ratio_text = VALUES(ratio_text), notes = VALUES(notes)`,
        [sym, a.ex_date, a.action_type, a.numerator, a.denominator, a.factor, a.ratio_text, (a.subject || '').slice(0, 250)]
      );
      n++;
    } catch (e) {
      logger.warn(`[CorpLoader] upsert ${sym} ${a.ex_date}: ${e.message}`);
    }
  }
  return n;
}

// Fetch NSE → parse → upsert for one symbol. Returns { fetched, parsed, saved }.
async function loadForSymbol(symbol) {
  const nse = require('./nseFetcher');
  let rows = [];
  try {
    rows = await nse.getCorporateActions(symbol);
  } catch (e) {
    logger.warn(`[CorpLoader] NSE fetch failed for ${symbol}: ${e.message}`);
    return { symbol, fetched: 0, parsed: 0, saved: 0, error: e.message };
  }
  const actions = extractActions(rows);
  const saved = await upsertActions(symbol, actions);
  logger.info(`[CorpLoader] ${symbol}: ${Array.isArray(rows) ? rows.length : 0} rows → ${actions.length} split/bonus → ${saved} saved`);
  return { symbol, fetched: Array.isArray(rows) ? rows.length : 0, parsed: actions.length, saved };
}

// Load many symbols sequentially (NSE rate-limits hard).
async function loadMany(symbols) {
  const results = [];
  for (const s of symbols) results.push(await loadForSymbol(s));
  return results;
}

module.exports = { parsePurpose, parseDate, extractActions, upsertActions, loadForSymbol, loadMany };
