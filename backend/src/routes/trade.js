'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/tradeController');

router.post('/order',                ctrl.placeOrder);
router.get('/portfolio',             ctrl.getPortfolio);
router.get('/orders',                ctrl.getOrders);
router.post('/check-exits',          ctrl.checkExits);
router.post('/size',                 ctrl.computeSize);

module.exports = router;
