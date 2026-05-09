// src/routes/feedback.js
'use strict';

const router = require('express').Router();
const { submitFeedback } = require('../controllers/authController');
const { optionalAuth }   = require('../middleware/authMiddleware');

// Public endpoint — optional auth (attaches userId if logged in)
router.post('/', optionalAuth, submitFeedback);

module.exports = router;