// src/portfolio/portfolioState.js
// ─────────────────────────────────────────────────────────────────────────────
// In-memory portfolio state: capital, positions, trade history.
// Capital is USER-DEFINED via /api/sim/start — no hardcoded values.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_CAPITAL = 100000; // fallback only until user calls /api/sim/start

const state = {
  capital:        DEFAULT_CAPITAL,
  initialCapital: DEFAULT_CAPITAL,
  positions:      {},
  trades:         [],
  initialized:    false,   // false until user calls POST /api/sim/start
};

// ── Init / Reset ──────────────────────────────────────────────────────────────

/**
 * Initialize portfolio with user-defined capital.
 * Called by POST /api/sim/start
 * Clears all positions and trades.
 *
 * @param {number} capital - User-supplied starting capital in ₹
 * @throws {Error} with .statusCode = 400 if invalid
 */
function initialize(capital) {
  const cap = Number(capital);
  if (!Number.isFinite(cap) || cap <= 0) {
    const err = new Error('capital must be a positive number');
    err.statusCode = 400;
    throw err;
  }
  if (cap < 1) {
    const err = new Error('capital must be at least ₹1');
    err.statusCode = 400;
    throw err;
  }
  state.capital        = parseFloat(cap.toFixed(2));
  state.initialCapital = parseFloat(cap.toFixed(2));
  state.positions      = {};
  state.trades         = [];
  state.initialized    = true;
}

/**
 * Reset portfolio back to initialCapital (stored from last /api/sim/start).
 * Called by POST /api/sim/reset
 */
function resetToInitial() {
  state.capital   = state.initialCapital;
  state.positions = {};
  state.trades    = [];
  // initialCapital and initialized flag preserved
}

/**
 * Hard reset for testing — clears everything.
 * @param {number} [startingCapital]
 */
function reset(startingCapital) {
  const cap            = startingCapital != null ? Number(startingCapital) : DEFAULT_CAPITAL;
  state.capital        = cap;
  state.initialCapital = cap;
  state.positions      = {};
  state.trades         = [];
  state.initialized    = false;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Get snapshot of full portfolio state.
 * @returns {{ capital, initialCapital, positions, trades, initialized }}
 */
function getState() {
  return {
    capital:        parseFloat(state.capital.toFixed(2)),
    initialCapital: parseFloat(state.initialCapital.toFixed(2)),
    positions:      { ...state.positions },
    trades:         [...state.trades],
    initialized:    state.initialized,
  };
}

/** Whether portfolio has been initialized by the user. */
function isInitialized() {
  return state.initialized;
}

// ── Trade execution ───────────────────────────────────────────────────────────

/**
 * Execute a BUY trade.
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @returns {{ trade, capital, position }}
 * @throws {Error} .statusCode = 400
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

  state.capital -= cost;

  const existing = state.positions[symbol];
  if (existing) {
    const totalQty      = existing.qty + qty;
    const totalCost     = existing.qty * existing.entryPrice + cost;
    const avgEntryPrice = totalCost / totalQty;
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
 * @param {string} symbol
 * @param {number} qty
 * @param {number} price
 * @returns {{ trade, capital, position|null, pnl }}
 * @throws {Error} .statusCode = 400
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

  const proceeds  = qty * price;
  const costBasis = qty * existing.entryPrice;
  const pnl       = parseFloat((proceeds - costBasis).toFixed(2));

  state.capital += proceeds;

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

module.exports = {
  initialize,
  resetToInitial,
  reset,
  getState,
  isInitialized,
  executeBuy,
  executeSell,
};
