// src/controllers/authController.js
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const portfolioRepo = require('../portfolio/portfolioRepository');
const auditLog = require('../middleware/auditLog');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_min_32_chars_please!!';
const JWT_EXPIRY = parseInt(process.env.JWT_EXPIRY_SECONDS || '604800', 10);
const BCRYPT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────────────────────

function signJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
async function signup(req, res) {
  const { email, password, name } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ success: false, error: 'Email and password required' });
  if (password.length < 8)
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing[0])
      return res.status(409).json({ success: false, error: 'Email already registered' });

    const hashed = hashPassword(password);
    const [rows] = await db.query(
      `INSERT INTO users (email, password, name, role, provider)
   VALUES (?, ?, ?, 'user', 'local')
   RETURNING id`,
      [email, hashed, name || null]
    );

    const userId = rows[0].id;
    await portfolioRepo.createPortfolio(1000000, userId);

    // Send welcome email (non-blocking)
    try {
      const { sendWelcome } = require('../services/emailService');
      sendWelcome(email, name).catch(() => { });
    } catch (_) { }

    const token = signJWT({ userId, email, role: 'user' });
    logger.info(`[Auth] Signup: ${email}`);
    auditLog('auth.signup', req, { userId, email });
    return res.status(201).json({
      success: true, token,
      user: { id: userId, email, name: name || null, role: 'user', provider: 'local' },
    });
  } catch (err) {
    logger.error(`[Auth] signup: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ success: false, error: 'Email and password required' });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !user.password) {
      auditLog('auth.login_failed', req, { email, reason: 'no_such_user' });
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      auditLog('auth.login_failed', req, { userId: user.id, email, reason: 'bad_password' });
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const token = signJWT({ userId: user.id, email: user.email, role: user.role });

    // Non-blocking side effects
    db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]).catch(() => { });

    logger.info(`[Auth] Login: ${email}`);
    auditLog('auth.login', req, { userId: user.id, email });
    return res.json({
      success: true, token, expiresIn: JWT_EXPIRY,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        picture: user.picture,
        provider: user.provider || 'local',
      },
    });
  } catch (err) {
    logger.error(`[Auth] login: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
async function me(req, res) {
  const userId = req.user?.userId ?? req.user?.id;
  try {
    const [rows] = await db.query(
      'SELECT id, email, name, role, picture, provider, trading_mode FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    logger.error(`[Auth] me: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
async function forgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, error: 'Email required' });

  // Always return success — prevents email enumeration
  const SUCCESS_MSG = { success: true, message: 'If that email exists, a reset link was sent.' };

  try {
    const [rows] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (!rows[0]) return res.json(SUCCESS_MSG);

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `INSERT INTO password_resets (user_id, token, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE
       SET token = EXCLUDED.token,
           expires_at = EXCLUDED.expires_at,
           created_at = CURRENT_TIMESTAMP`,
      [rows[0].id, token, expiry]
    );

    logger.info(`[Auth] Password reset requested for ${email}`);

    // Send email
    try {
      const { sendPasswordReset } = require('../services/emailService');
      await sendPasswordReset(email, token);
    } catch (emailErr) {
      logger.warn(`[Auth] Email send failed: ${emailErr.message}`);
      // Fall back to dev token in non-production
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ ...SUCCESS_MSG, _devToken: token });
      }
    }

    return res.json(SUCCESS_MSG);
  } catch (err) {
    logger.error(`[Auth] forgotPassword: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

// ── POST /api/auth/reset-password ────────────────────────────────────────────
async function resetPassword(req, res) {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res.status(400).json({ success: false, error: 'Token and password required' });
  if (password.length < 8)
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

  try {
    const [rows] = await db.query(
      `SELECT pr.user_id FROM password_resets pr
       WHERE pr.token = ? AND pr.expires_at > CURRENT_TIMESTAMP LIMIT 1`,
      [token]
    );
    if (!rows[0])
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });

    const hashed = hashPassword(password);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, rows[0].user_id]);
    await db.query('DELETE FROM password_resets WHERE user_id = ?', [rows[0].user_id]);

    logger.info(`[Auth] Password reset complete for user ${rows[0].user_id}`);
    auditLog('auth.password_reset', req, { userId: rows[0].user_id });
    return res.json({ success: true, message: 'Password updated. Please log in.' });
  } catch (err) {
    logger.error(`[Auth] resetPassword: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}

// ── POST /api/feedback ────────────────────────────────────────────────────────
async function submitFeedback(req, res) {
  const { name, email, type, message, rating } = req.body || {};
  if (!message || message.trim().length < 10)
    return res.status(400).json({ success: false, error: 'Message must be at least 10 characters' });

  try {
    await db.query(
      `INSERT INTO feedback (name, email, type, message, rating, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        (name || '').slice(0, 100),
        (email || '').slice(0, 255),
        (type || 'general').slice(0, 50),
        message.trim().slice(0, 2000),
        rating ? parseInt(rating, 10) : null,
        req.user?.userId ?? req.user?.id ?? null,
      ]
    );
    logger.info(`[Feedback] from ${email || 'anonymous'}: ${type}`);
    return res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    logger.error(`[Feedback] ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not save feedback' });
  }
}

module.exports = {
  signup, login, me,
  forgotPassword, resetPassword,
  submitFeedback,
  signJWT, verifyJWT,
};
