// src/routes/live.js
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/liveController');
const { requireAuth }  = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rbac');

router.use(requireAuth);

router.post  ('/order',                ctrl.placeOrder);
router.get   ('/positions',            ctrl.getPositions);
router.get   ('/orders',               ctrl.getOrders);
router.get   ('/funds',                ctrl.getFunds);
router.delete('/order/:brokerOrderId', ctrl.cancelOrder);
router.get   ('/status',               ctrl.getStatus);
router.post  ('/mode',                 ctrl.setMode);
// rbac.requireAdmin existed but was never applied anywhere in the app —
// this endpoint previously relied solely on an inline role check inside
// the controller. Now enforced at the route boundary too (defense in depth).
router.post  ('/admin/kill-switch',    requireAdmin, ctrl.killSwitch);

module.exports = router;
