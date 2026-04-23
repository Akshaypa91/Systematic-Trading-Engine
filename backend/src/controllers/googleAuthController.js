// src/controllers/googleAuthController.js
'use strict';

const { OAuth2Client } = require('google-auth-library');
const db     = require('../config/database');
const logger = require('../config/logger');
const { signJWT } = require('./authController');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client    = new OAuth2Client(CLIENT_ID);

/**
 * POST /api/auth/google
 * Body: { credential } — Google ID token from frontend
 */
async function googleAuth(req, res) {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ success: false, error: 'credential required' });
  if (!CLIENT_ID)  return res.status(500).json({ success: false, error: 'GOOGLE_CLIENT_ID not configured' });

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn(`[GoogleAuth] Token verify failed: ${err.message}`);
    return res.status(401).json({ success: false, error: 'Invalid Google token' });
  }

  const { email, name, picture, sub: googleId } = payload;
  if (!email) return res.status(400).json({ success: false, error: 'No email in Google token' });

  try {
    // Check existing user
    const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    let user = rows[0];

    if (user) {
      // Existing user — update provider if needed
      if (user.provider === 'local') {
        // Local user logging in with Google — link accounts
        await db.query(
          'UPDATE users SET provider = "google", google_id = ?, picture = ?, updated_at = NOW() WHERE id = ?',
          [googleId, picture, user.id]
        );
      }
      logger.info(`[GoogleAuth] Login: ${email}`);
    } else {
      // New user — create
      const [result] = await db.query(
        `INSERT INTO users (email, name, password, provider, google_id, picture, role, created_at)
         VALUES (?, ?, NULL, 'google', ?, ?, 'user', NOW())`,
        [email, name || email.split('@')[0], googleId, picture]
      );
      const [newRows] = await db.query('SELECT * FROM users WHERE id = ? LIMIT 1', [result.insertId]);
      user = newRows[0];
      logger.info(`[GoogleAuth] Signup: ${email}`);
    }

    const token = signJWT({ userId: user.id, email: user.email, role: user.role || 'user' });

    // Auto-create portfolio if user has none (best-effort)
    db.query(
      `SELECT id FROM portfolios WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [user.id]
    ).then(([rows]) => {
      if (!rows.length) {
        return db.query(
          `INSERT INTO portfolios (user_id, initial_capital, current_capital, status) VALUES (?, 1000000, 1000000, 'ACTIVE')`,
          [user.id]
        ).then(() => logger.info(`[GoogleAuth] Auto-created portfolio for user ${user.id}`));
      }
    }).catch(e => logger.warn(`[GoogleAuth] Portfolio auto-create: ${e.message}`));

    return res.json({
      success: true,
      token,
      user: {
        id:      user.id,
        email:   user.email,
        name:    user.name,
        picture: user.picture,
        role:    user.role,
        provider:'google',
      },
    });
  } catch (err) {
    logger.error(`[GoogleAuth] DB error: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

module.exports = { googleAuth };
