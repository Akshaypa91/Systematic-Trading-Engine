// src/routes/auth.js
'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/authController');

router.post('/signup', ctrl.signup);
router.post('/login',  ctrl.login);
router.get ('/me',     ctrl.me);

module.exports = router;
