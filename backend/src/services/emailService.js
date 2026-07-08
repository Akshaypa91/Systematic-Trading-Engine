// src/services/emailService.js — npm install resend
'use strict';
const logger = require('../config/logger');
let _resend = null;
function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) { logger.warn('[Email] RESEND_API_KEY not set'); return null; }
    const { Resend } = require('resend');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}
const FROM = process.env.EMAIL_FROM || 'SYSTRA <noreply@systra.trade>';

// FRONTEND_URL must be a single URL — if it's ever set to a comma-separated
// list (e.g. copy-pasted from ALLOWED_ORIGINS), fall back to the first one
// rather than building a broken link with a literal comma in it.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

async function sendPasswordReset(email, token) {
  const resend   = getResend();
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
  if (!resend) { logger.info(`[Email] DEV reset link for ${email}: ${resetUrl}`); return { success:true, dev:true, resetUrl }; }
  await resend.emails.send({
    from: FROM, to: email,
    subject: 'Reset your SYSTRA password',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#111827;color:#f9fafb;border-radius:16px">
      <h2 style="color:#3B82F6">Reset your password</h2>
      <p style="color:#94a3b8">Click the link below to reset your password. Expires in 1 hour.</p>
      <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#3B82F6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password →</a>
      <p style="color:#4B5563;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
    </div>`,
  });
  logger.info(`[Email] Reset sent to ${email}`);
  return { success: true };
}

async function sendWelcome(email, name) {
  const resend = getResend();
  if (!resend) { logger.info(`[Email] DEV welcome skipped for ${email}`); return; }
  try {
    await resend.emails.send({
      from: FROM, to: email,
      subject: 'Welcome to SYSTRA',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#111827;color:#f9fafb;border-radius:16px">
        <h2 style="color:#3B82F6">Welcome, ${name || 'Trader'}!</h2>
        <p style="color:#94a3b8">Your SYSTRA account is ready. Start trading with ₹10,00,000 virtual capital.</p>
        <a href="${FRONTEND_URL}" style="display:inline-block;padding:12px 24px;background:#3B82F6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Dashboard →</a>
      </div>`,
    });
  } catch (err) { logger.warn(`[Email] Welcome failed: ${err.message}`); }
}

module.exports = { sendPasswordReset, sendWelcome };
