// src/routes/live.js
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/liveController');
const { requireAuth }  = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rbac');

router.use(requireAuth);

router.post  ('/order',                ctrl.placeOrder);
router.post  ('/charges',              ctrl.getCharges);       // preview brokerage/taxes
router.get   ('/positions',            ctrl.getPositions);
router.post  ('/positions/exit',       ctrl.exitPosition);     // square off one position
router.get   ('/orders',               ctrl.getOrders);        // normalized Live Order Book
router.get   ('/funds',                ctrl.getFunds);
router.get   ('/funds/normalized',     ctrl.getFundsNormalized);
router.get   ('/holdings',             ctrl.getHoldings);      // portfolio holdings + allocation
router.delete('/order/:brokerOrderId', ctrl.cancelOrder);

// ── Risk + emergency (Phase 3) ────────────────────────────────────────────────
router.get   ('/risk',                 ctrl.getRisk);
router.put   ('/risk',                 ctrl.setRisk);
router.post  ('/kill-switch',          ctrl.setKillSwitch);
router.post  ('/emergency/stop',       ctrl.emergencyStop);
router.post  ('/emergency/square-off', ctrl.squareOffAll);
router.post  ('/emergency/cancel-all', ctrl.cancelAllOrders);
router.get   ('/status',               ctrl.getStatus);
router.get   ('/diagnostics',          ctrl.getDiagnostics);   // real-time market-data diagnostics
router.post  ('/mode',                 ctrl.setMode);

// ── Broker (Upstox) connection — Phase 1: read-only status + connection mgmt ──
router.get   ('/broker/status',        ctrl.getBrokerStatus);
router.post  ('/broker/reconnect',     ctrl.brokerReconnect);
router.post  ('/broker/disconnect',    ctrl.brokerDisconnect);
router.post  ('/broker/refresh',       ctrl.brokerRefresh);
// rbac.requireAdmin existed but was never applied anywhere in the app —
// this endpoint previously relied solely on an inline role check inside
// the controller. Now enforced at the route boundary too (defense in depth).
router.post  ('/admin/kill-switch',    requireAdmin, ctrl.killSwitch);

module.exports = router;
