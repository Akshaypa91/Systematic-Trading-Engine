'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tradeJournalController');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/', requireAuth, ctrl.listJournal);
router.post('/', requireAuth, ctrl.createJournal);
router.get('/analytics', requireAuth, ctrl.getJournalAnalytics);
router.put('/:id', requireAuth, ctrl.updateJournal);
router.delete('/:id', requireAuth, ctrl.deleteJournal);

module.exports = router;
