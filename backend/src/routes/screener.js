'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/screenerController');

router.get('/',                      ctrl.runScreener);
router.get('/score/:symbol',         ctrl.scoreSymbol);

module.exports = router;
