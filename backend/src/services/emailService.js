// src/services/emailService.js
// npm install resend
// Add RESEND_API_KEY to .env
'use strict';

const logger = require('../config/logger');
let _resend = null;

function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      logger.warn('[Email] RESEND_API_KEY not set — emails disabled');
      return null;
    }
    const { Resend } = require('resend');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM = process.env.EMAIL_FROM || 'SYSTRA <noreply@systra.trade>';
const APP_NAME = 'SYSTRA';

// ── Password Reset ────────────────────────────────────────────────────────────
async function sendPasswordReset(email, token) {
  const resend = getResend();
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;

  if (!resend) {
    // Dev fallback — log the URL
    logger.info(`[Email] DEV reset link for ${email}: ${resetUrl}`);
    return { success: true, dev: true, resetUrl };
  }

  try {
    await resend.emails.send({
      from:    FROM,
      to:      email,
      subject: `Reset your ${APP_NAME} password`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family:Inter,sans-serif;background:#0B1220;color:#F9FAFB;padding:40px 20px;margin:0">
          <div style="max-width:480px;margin:0 auto;background:#111827;border:1px solid #1F2937;border-radius:16px;padding:40px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
              <div style="width:40px;height:40px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">⚡</div>
              <div>
                <div style="font-size:16px;font-weight:700;letter-spacing:0.1em;color:#3B82F6">SYSTRA</div>
                <div style="font-size:11px;color:#4B5563;font-family:monospace">Systematic Trading Engine</div>
              </div>
            </div>
            <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#F9FAFB">Reset your password</h2>
            <p style="color:#94A3B8;line-height:1.7;margin:0 0 28px">
              We received a request to reset the password for your SYSTRA account.
              Click the button below to choose a new password. This link expires in <strong style="color:#F9FAFB">1 hour</strong>.
            </p>
            <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.4);border-radius:8px;color:#3B82F6;text-decoration:none;font-weight:600;font-size:14px">
              Reset Password →
            </a>
            <p style="color:#4B5563;font-size:12px;margin-top:28px;line-height:1.6">
              If you didn't request this, you can safely ignore this email.
              Your password will not be changed.<br><br>
              For security, never share this link with anyone.
            </p>
            <hr style="border:none;border-top:1px solid #1F2937;margin:24px 0">
            <p style="color:#374151;font-size:11px;font-family:monospace">
              SYSTRA · Systematic Trading Engine · NSE India
            </p>
          </div>
        </body>
        </html>
      `,
    });
    logger.info(`[Email] Password reset sent to ${email}`);
    return { success: true };
  } catch (err) {
    logger.error(`[Email] Failed to send reset to ${email}: ${err.message}`);
    throw err;
  }
}

// ── Welcome Email ─────────────────────────────────────────────────────────────
async function sendWelcome(email, name) {
  const resend = getResend();
  if (!resend) { logger.info(`[Email] DEV welcome skipped for ${email}`); return; }

  try {
    await resend.emails.send({
      from:    FROM,
      to:      email,
      subject: `Welcome to ${APP_NAME} — Your trading engine is ready`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family:Inter,sans-serif;background:#0B1220;color:#F9FAFB;padding:40px 20px;margin:0">
          <div style="max-width:480px;margin:0 auto;background:#111827;border:1px solid #1F2937;border-radius:16px;padding:40px">
            <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#F9FAFB">Welcome, ${name || 'Trader'}! 👋</h2>
            <p style="color:#94A3B8;line-height:1.7;margin:0 0 20px">
              Your SYSTRA account is ready. You now have access to:
            </p>
            <ul style="color:#94A3B8;line-height:2;padding-left:20px">
              <li>📊 Paper trading with ₹10,00,000 virtual capital</li>
              <li>🔍 NSE stock screener (240+ symbols)</li>
              <li>📈 Strategy backtesting with real OHLCV data</li>
              <li>⚡ Live signal generation (RSI + MA + BB)</li>
              <li>🔗 Upstox broker integration for live trading</li>
            </ul>
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.4);border-radius:8px;color:#3B82F6;text-decoration:none;font-weight:600;font-size:14px">
              Open Dashboard →
            </a>
          </div>
        </body>
        </html>
      `,
    });
    logger.info(`[Email] Welcome sent to ${email}`);
  } catch (err) {
    logger.warn(`[Email] Welcome failed for ${email}: ${err.message}`);
    // Non-fatal
  }
}

module.exports = { sendPasswordReset, sendWelcome };
