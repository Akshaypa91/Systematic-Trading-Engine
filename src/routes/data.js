'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/dataController');

router.get('/quote/:symbol',          ctrl.getQuote);
router.get('/historical/:symbol',     ctrl.getHistorical);
router.post('/fetch-and-store/:symbol', ctrl.fetchAndStore);
router.get('/prices/:symbol',         ctrl.getPrices);
router.get('/nifty50',                ctrl.getNifty50);
router.get('/market-status',          ctrl.getMarketStatus);

module.exports = router;
