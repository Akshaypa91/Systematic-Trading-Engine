// src/routes/live.js
'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/liveController');
const { requireAuth } = require('../middleware/authMiddleware');

router.use(requireAuth);

router.post  ('/order',                ctrl.placeOrder);
router.get   ('/positions',            ctrl.getPositions);
router.get   ('/orders',               ctrl.getOrders);
router.get   ('/funds',                ctrl.getFunds);
router.delete('/order/:brokerOrderId', ctrl.cancelOrder);
router.get   ('/status',               ctrl.getStatus);
router.post  ('/mode',                 ctrl.setMode);
router.post  ('/admin/kill-switch',    ctrl.killSwitch);

module.exports = router;
