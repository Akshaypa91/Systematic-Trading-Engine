// src/controllers/authController.js — Hardened Auth
'use strict';

const crypto = require('crypto');
const db     = require('../config/database');
const logger = require('../config/logger');

// ── Config ────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = parseInt(process.env.JWT_EXPIRY_SECONDS || String(7 * 24 * 60 * 60), 10);

// Enforce minimum secret length at startup
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  logger.warn('[Auth] ⚠️  JWT_SECRET is missing or too short — set a strong 64-char secret in production');
}

// ── JWT (no external deps, HMAC-SHA256) ───────────────────────────────────────
function _b64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');
  const now    = Math.floor(Date.now() / 1000);
  const header = _b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = _b64url(JSON.stringify({ ...payload, iat: now, exp: now + JWT_EXPIRY }));
  const sig    = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');
  if (!token || typeof token !== 'string') throw new Error('Token is required');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');

  // Constant-time comparison prevents timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid token signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    throw new Error('Token payload is not valid JSON');
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token has expired');
  return payload;
}

// ── Password hashing (scrypt — CPU-hard, resistant to GPU attacks) ────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch {
    return false;
  }
}

// ── Ensure users table exists ─────────────────────────────────────────────────
async function _ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      email      VARCHAR(255) NOT NULL UNIQUE,
      password   VARCHAR(512) NOT NULL,
      role       ENUM('admin','user') NOT NULL DEFAULT 'user',
      is_active  TINYINT(1) NOT NULL DEFAULT 1,
      last_login DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_email (email)
    )
  `);
}

// ── Input validation ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function _validateEmail(email) {
  return email && EMAIL_RE.test(email.toLowerCase()) && email.length <= 255;
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
async function signup(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password)
    return res.status(400).json({ success: false, error: 'Email and password are required' });

  if (!_validateEmail(email))
    return res.status(400).json({ success: false, error: 'Invalid email address' });

  if (password.length < 8)
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

  if (password.length > 128)
    return res.status(400).json({ success: false, error: 'Password too long (max 128 chars)' });

  try {
    await _ensureTable();

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0)
      return res.status(409).json({ success: false, error: 'Email already registered' });

    const hashed = hashPassword(password);
    await db.query(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email.toLowerCase(), hashed]
    );

    logger.info(`[Auth] New user: ${email}`);
    res.status(201).json({ success: true, message: 'Account created. Please sign in.' });
  } catch (err) {
    logger.logError('Auth.signup', err, { email });
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password)
    return res.status(400).json({ success: false, error: 'Email and password are required' });

  try {
    await _ensureTable();

    const [rows] = await db.query(
      'SELECT id, email, password, role, is_active FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    // Always hash attempt even if user not found — prevents timing-based user enumeration
    const dummyHash = 'a'.repeat(32) + ':' + 'b'.repeat(128);
    const storedHash = rows[0]?.password || dummyHash;
    const valid = verifyPassword(password, storedHash) && rows.length > 0;

    if (!valid || !rows[0]?.is_active) {
      logger.warn(`[Auth] Failed login attempt: ${email}`);
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user  = rows[0];
    const token = signJWT({ userId: user.id, email: user.email, role: user.role });

    // Update last_login (best-effort)
    db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]).catch(() => {});

    logger.info(`[Auth] Login: ${email}`);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, role: user.role },
      expiresIn: JWT_EXPIRY,
    });
  } catch (err) {
    logger.logError('Auth.login', err, { email });
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
function me(req, res) {
  const authHeader = (req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: 'Authentication required' });

  try {
    const payload = verifyJWT(authHeader.slice(7));
    res.json({
      success: true,
      user: { userId: payload.userId, email: payload.email, role: payload.role },
    });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
}

module.exports = { signup, login, me, verifyJWT };
