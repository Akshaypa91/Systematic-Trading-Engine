// src/engine/orderLifecycle.js
// ─────────────────────────────────────────────────────────────────────────────
// Canonical order state machine for the live OMS. Broker order books report a
// zoo of status strings ("open", "trigger pending", "complete", "rejected"…);
// we normalize them to one vocabulary and enforce LEGAL transitions so a stale
// or out-of-order broker update can never move an order backwards (e.g. from
// COMPLETED back to PENDING). Pure + fully unit-tested — no DB, no network.
//
// States:
//   NEW       — created locally, not yet acknowledged by the broker
//   PENDING   — live at the exchange, unfilled (open / trigger pending / placed)
//   PARTIAL   — partially filled
//   COMPLETED — fully filled (terminal)
//   REJECTED  — rejected by broker/exchange (terminal)
//   CANCELLED — cancelled (terminal)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const STATES = ['NEW', 'PENDING', 'PARTIAL', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);
const OPEN     = new Set(['NEW', 'PENDING', 'PARTIAL']);

// Allowed forward transitions. Terminal states have none.
const TRANSITIONS = {
  NEW:       new Set(['PENDING', 'PARTIAL', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  PENDING:   new Set(['PARTIAL', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  PARTIAL:   new Set(['PARTIAL', 'COMPLETED', 'REJECTED', 'CANCELLED']),
  COMPLETED: new Set(),
  REJECTED:  new Set(),
  CANCELLED: new Set(),
};

// Map any broker/DB status string → canonical state.
function normalize(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s) return 'NEW';
  if (s.includes('reject'))                                   return 'REJECTED';
  if (s.includes('cancel'))                                   return 'CANCELLED';
  if (s.includes('complete') || s === 'filled' || s === 'executed') return 'COMPLETED';
  if (s.includes('partial'))                                  return 'PARTIAL';
  if (s.includes('open') || s.includes('trigger') || s.includes('pending')
      || s.includes('placed') || s.includes('validation') || s.includes('modify')
      || s.includes('put order req received') || s.includes('after market order req received')) return 'PENDING';
  if (s === 'new')                                            return 'NEW';
  return 'PENDING';  // unknown but live-ish → treat as pending, never terminal
}

const isTerminal = (state) => TERMINAL.has(normalize(state));
const isOpen     = (state) => OPEN.has(normalize(state));

// Can we legally move from → to? (Idempotent no-op if from === to.)
function canTransition(from, to) {
  const f = normalize(from), t = normalize(to);
  if (f === t) return true;
  return TRANSITIONS[f]?.has(t) || false;
}

/**
 * Resolve the next state given the current one and an incoming broker status.
 * Returns { state, changed, illegal }.
 *   - illegal=true means the broker update would be an illegal transition
 *     (e.g. terminal→open); we keep the current state and flag it.
 */
function transition(current, incoming) {
  const from = normalize(current);
  const to   = normalize(incoming);
  if (from === to)               return { state: from, changed: false, illegal: false };
  if (TRANSITIONS[from]?.has(to)) return { state: to,   changed: true,  illegal: false };
  return { state: from, changed: false, illegal: true };
}

module.exports = { STATES, normalize, isTerminal, isOpen, canTransition, transition };
