// src/controllers/authController.js
'use strict';

const crypto = require('crypto');
const db     = require('../config/database');
const logger = require('../config/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'systra-secret-change-in-production';
const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

// ── Minimal JWT implementation (no external deps) ─────────────────────────────
function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload) {
  const header  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY }));
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  const [header, body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expected) throw new Error('Invalid token signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// ── Password hashing using built-in crypto ────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

// ── Ensure users table exists ─────────────────────────────────────────────────
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      email      VARCHAR(255) NOT NULL UNIQUE,
      password   VARCHAR(512) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
async function signup(req, res) {
  try {
    await ensureTable();
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0)
      return res.status(409).json({ success: false, error: 'Email already registered' });

    const hashed = hashPassword(password);
    const [result] = await db.query(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email.toLowerCase(), hashed]
    );

    logger.info(`[Auth] New user registered: ${email}`);
    res.status(201).json({ success: true, message: 'Account created. Please sign in.' });
  } catch (err) {
    logger.error(`[Auth] signup error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res) {
  try {
    await ensureTable();
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, error: 'Email and password are required' });

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!rows.length)
      return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const user = rows[0];
    const valid = verifyPassword(password, user.password);
    if (!valid)
      return res.status(401).json({ success: false, error: 'Invalid email or password' });

    const token = signJWT({ userId: user.id, email: user.email });
    logger.info(`[Auth] Login: ${email}`);

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    logger.error(`[Auth] login error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
function me(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'No token' });
    const payload = verifyJWT(token);
    res.json({ success: true, user: { userId: payload.userId, email: payload.email } });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
}

module.exports = { signup, login, me, verifyJWT };
