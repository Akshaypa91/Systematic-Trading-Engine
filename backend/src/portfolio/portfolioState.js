// src/portfolio/portfolioState.js
// ─────────────────────────────────────────────────────────────────────────────
// In-memory portfolio state: capital, positions, trade history.
// Single source of truth for manual trade execution.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  capital:   100000,   // Starting capital in ₹
  positions: {},       // { [symbol]: { qty, entryPrice, value } }
  trades:    [],       // Array of executed trade records
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get a snapshot of the full portfolio state.
 * @returns {{ capital, positions, trades }}
 */
function getState() {
  return {
    capital:   parseFloat(state.capital.toFixed(2)),
    positions: { ...state.positions },
    trades:    [...state.trades],
  };
}

/**
 * Execute a BUY trade.
 * Checks capital, deducts cost, adds/updates position.
 *
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @returns {{ trade, capital, position }}
 * @throws {Error} with .statusCode = 400 if insufficient capital
 */
function executeBuy(symbol, qty, price) {
  const cost = qty * price;

  if (state.capital < cost) {
    const err = new Error(
      `Insufficient capital. Need ₹${cost.toFixed(2)}, have ₹${state.capital.toFixed(2)}`
    );
    err.statusCode = 400;
    throw err;
  }

  // Deduct capital
  state.capital -= cost;

  // Add / average-up position
  const existing = state.positions[symbol];
  if (existing) {
    const totalQty        = existing.qty + qty;
    const totalCost       = existing.qty * existing.entryPrice + cost;
    const avgEntryPrice   = totalCost / totalQty;
    state.positions[symbol] = {
      qty:        totalQty,
      entryPrice: parseFloat(avgEntryPrice.toFixed(2)),
      value:      parseFloat((totalQty * price).toFixed(2)),
    };
  } else {
    state.positions[symbol] = {
      qty,
      entryPrice: parseFloat(price.toFixed(2)),
      value:      parseFloat(cost.toFixed(2)),
    };
  }

  const trade = _recordTrade({ symbol, action: 'BUY', qty, price });
  return { trade, capital: state.capital, position: state.positions[symbol] };
}

/**
 * Execute a SELL trade.
 * Checks position exists, increases capital, reduces/removes position.
 *
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @returns {{ trade, capital, position|null, pnl }}
 * @throws {Error} with .statusCode = 400 if no/insufficient position
 */
function executeSell(symbol, qty, price) {
  const existing = state.positions[symbol];

  if (!existing) {
    const err = new Error(`No open position for ${symbol}`);
    err.statusCode = 400;
    throw err;
  }

  if (qty > existing.qty) {
    const err = new Error(
      `Cannot sell ${qty} shares of ${symbol} — only ${existing.qty} held`
    );
    err.statusCode = 400;
    throw err;
  }

  // Calculate P&L for the sold portion
  const proceeds = qty * price;
  const costBasis = qty * existing.entryPrice;
  const pnl = parseFloat((proceeds - costBasis).toFixed(2));

  // Increase capital
  state.capital += proceeds;

  // Reduce or remove position
  let position = null;
  if (qty === existing.qty) {
    delete state.positions[symbol];
  } else {
    const remainingQty = existing.qty - qty;
    state.positions[symbol] = {
      qty:        remainingQty,
      entryPrice: existing.entryPrice,
      value:      parseFloat((remainingQty * price).toFixed(2)),
    };
    position = state.positions[symbol];
  }

  const trade = _recordTrade({ symbol, action: 'SELL', qty, price, pnl });
  return { trade, capital: state.capital, position, pnl };
}

/**
 * Reset portfolio to initial state (useful for testing).
 * @param {number} [startingCapital=100000]
 */
function reset(startingCapital = 100000) {
  state.capital   = startingCapital;
  state.positions = {};
  state.trades    = [];
}

// ── Private ───────────────────────────────────────────────────────────────────

function _recordTrade({ symbol, action, qty, price, pnl = null }) {
  const trade = {
    symbol,
    action,
    qty,
    price:     parseFloat(price.toFixed(2)),
    value:     parseFloat((qty * price).toFixed(2)),
    pnl,
    timestamp: new Date().toISOString(),
  };
  state.trades.push(trade);
  return trade;
}

module.exports = { getState, executeBuy, executeSell, reset };