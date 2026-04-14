'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/tradeController');
const { requireAuth } = require('../middleware/authMiddleware');

router.post('/order',                requireAuth, ctrl.placeOrder);
router.post('/manual',               requireAuth, ctrl.placeManualOrder);
router.get('/portfolio',             requireAuth, ctrl.getPortfolio);
router.get('/orders',                requireAuth, ctrl.getOrders);
router.post('/check-exits',          requireAuth, ctrl.checkExits);
router.post('/size',                 requireAuth, ctrl.computeSize);

module.exports = router;
