// src/utils/format.js
// SYSTRA number formatting — one source of truth for how money, percentages
// and prices render across the app. Keeps tabular figures consistent so
// tables and tiles line up and read like a real trading terminal.

const safe = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

/** Full rupee amount, grouped Indian-style. e.g. 1234567 -> "₹12,34,567" */
export function inr(v, { decimals = 0, sign = false } = {}) {
  const n = safe(v);
  const s = n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = sign && n > 0 ? '+' : '';
  return `${prefix}₹${s}`;
}

/** Compact money for hero tiles. 1250000 -> "₹12.5L", 23000000 -> "₹2.3Cr" */
export function inrCompact(v, { sign = false } = {}) {
  const n = safe(v);
  const abs = Math.abs(n);
  const s = n < 0 ? '-' : sign && n > 0 ? '+' : '';
  if (abs >= 1e7) return `${s}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${s}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${s}₹${(abs / 1e3).toFixed(1)}K`;
  return `${s}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Price with 2 decimals. 2841.5 -> "₹2,841.50" */
export function price(v) {
  if (v == null) return '—';
  return `₹${safe(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Percentage with a leading sign. 4.2 -> "+4.20%" */
export function pct(v, { decimals = 2, sign = true } = {}) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = safe(v);
  const prefix = sign && n > 0 ? '+' : '';
  return `${prefix}${n.toFixed(decimals)}%`;
}

/** Plain grouped number. 12345 -> "12,345" */
export function num(v, decimals = 0) {
  return safe(v).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Semantic tone from a signed value, for coloring. */
export function toneOf(v) {
  const n = safe(v);
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'flat';
}

/** CSS var for a signed value. */
export function colorOf(v) {
  const n = safe(v);
  if (n > 0) return 'var(--green)';
  if (n < 0) return 'var(--red)';
  return 'var(--text-secondary)';
}
