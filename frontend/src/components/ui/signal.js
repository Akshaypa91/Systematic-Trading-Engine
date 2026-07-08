// Signal helpers shared across the design system.
// Kept in a plain module (not a component file) so Fast Refresh stays happy.

// Map a raw signal string ('BUY'|'SELL'|'HOLD') to a Badge tone.
export function signalTone(signal) {
  const s = String(signal || '').toUpperCase();
  if (s === 'BUY') return 'buy';
  if (s === 'SELL') return 'sell';
  return 'hold';
}

// Theme token color for a signal side.
export function signalColor(signal) {
  const s = String(signal || '').toUpperCase();
  if (s === 'BUY') return 'var(--green)';
  if (s === 'SELL') return 'var(--red)';
  return 'var(--amber)';
}
