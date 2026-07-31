// src/routes/live.js
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/liveController');
const { requireAuth }  = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rbac');
const { requireBrokerOwner } = require('../middleware/brokerOwner');

router.use(requireAuth);

// ── Account-scoped: real money and real holdings ─────────────────────────────
// Everything below reads or mutates the LINKED broker account, so being logged
// in is not sufficient — the caller must be the user who linked it.
// Before requireBrokerOwner existed, requireAuth alone let any registered user
// read another person's funds and place live orders on their account.
router.post  ('/order',                requireBrokerOwner, ctrl.placeOrder);
router.get   ('/positions',            requireBrokerOwner, ctrl.getPositions);
router.post  ('/positions/exit',       requireBrokerOwner, ctrl.exitPosition);     // square off one position
router.get   ('/orders',               requireBrokerOwner, ctrl.getOrders);        // normalized Live Order Book
router.get   ('/funds',                requireBrokerOwner, ctrl.getFunds);
router.get   ('/funds/normalized',     requireBrokerOwner, ctrl.getFundsNormalized);
router.get   ('/holdings',             requireBrokerOwner, ctrl.getHoldings);      // portfolio holdings + allocation
router.delete('/order/:brokerOrderId', requireBrokerOwner, ctrl.cancelOrder);

// Charges is a pure pricing calculator over the request body — no account data
// is read, so it stays open to any authenticated user.
router.post  ('/charges',              ctrl.getCharges);       // preview brokerage/taxes

// ── Risk + emergency (Phase 3) ────────────────────────────────────────────────
// Emergency controls act on the linked account's live orders and positions, so
// they are owner-gated too. Risk limits and the kill switch are deployment-wide
// safety settings and stay available to any authenticated user — a stricter
// limit or a halt can only ever reduce risk.
router.get   ('/risk',                 ctrl.getRisk);
router.put   ('/risk',                 ctrl.setRisk);
router.post  ('/kill-switch',          ctrl.setKillSwitch);
router.post  ('/emergency/stop',       ctrl.emergencyStop);
router.post  ('/emergency/square-off', requireBrokerOwner, ctrl.squareOffAll);
router.post  ('/emergency/cancel-all', requireBrokerOwner, ctrl.cancelAllOrders);
router.get   ('/status',               ctrl.getStatus);
router.get   ('/diagnostics',          ctrl.getDiagnostics);   // real-time market-data diagnostics
router.get   ('/execution-quality',    requireBrokerOwner, ctrl.getExecutionQuality); // slippage from this account's fills
router.get   ('/targets',              ctrl.getTargets);       // exit intents (SL/TP/trailing)
router.post  ('/targets',              ctrl.setTarget);
router.delete('/targets/:symbol',      ctrl.clearTarget);
router.post  ('/mode',                 ctrl.setMode);

// ── Broker (Upstox) connection — Phase 1: read-only status + connection mgmt ──
// getBrokerStatus is intentionally NOT owner-gated: a non-owner must be able to
// ask "is a broker linked to me?" and be told no. The controller reports
// disconnected to non-owners rather than leaking the account details.
router.get   ('/broker/status',        ctrl.getBrokerStatus);
router.post  ('/broker/reconnect',     requireBrokerOwner, ctrl.brokerReconnect);
router.post  ('/broker/disconnect',    requireBrokerOwner, ctrl.brokerDisconnect);
router.post  ('/broker/refresh',       requireBrokerOwner, ctrl.brokerRefresh);
// rbac.requireAdmin existed but was never applied anywhere in the app —
// this endpoint previously relied solely on an inline role check inside
// the controller. Now enforced at the route boundary too (defense in depth).
router.post  ('/admin/kill-switch',    requireAdmin, ctrl.killSwitch);

module.exports = router;
