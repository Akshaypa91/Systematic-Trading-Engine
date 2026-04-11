'use strict';
const router = require('express').Router();
const ctrl   = require('../controllers/screenerController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/',                      requireAuth, ctrl.runScreener);
router.get('/score/:symbol',         requireAuth, ctrl.scoreSymbol);

module.exports = router;
