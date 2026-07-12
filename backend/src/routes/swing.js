// src/routes/swing.js — Fresh 52wk Breakout scan (strategy by Akshay Pagare)
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const swingScan = require('../services/swingScanService');

const router = express.Router();

// Current scan state + cached results
router.get('/scan', requireAuth, (req, res) => {
  res.json({ success: true, ...swingScan.getState() });
});

// Kick off a background scan (no-op if one is already running)
router.post('/scan/run', requireAuth, async (req, res) => {
  const out = await swingScan.runScan();
  res.json({ success: true, ...out });
});

// Persisted signal history (deduped per day+symbol)
router.get('/history', requireAuth, async (req, res) => {
  try {
    const signals = await swingScan.getHistory({ limit: req.query.limit });
    res.json({ success: true, signals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
