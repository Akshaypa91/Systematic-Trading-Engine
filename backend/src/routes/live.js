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
router.get   ('/orders',               ctrl.getOrders);        // normalized Live Order Book
router.get   ('/funds',                ctrl.getFunds);
router.delete('/order/:brokerOrderId', ctrl.cancelOrder);
router.get   ('/status',               ctrl.getStatus);
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
