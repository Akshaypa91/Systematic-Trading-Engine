'use strict';

const db = require('../config/database');
const logger = require('../config/logger');

function userIdFrom(req) {
  return req.user?.userId ?? req.user?.id ?? null;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20);
  if (typeof tags === 'string') {
    return tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
  }
  return [];
}

function serialize(row) {
  return {
    id: row.id,
    tradeId: row.trade_id,
    symbol: row.symbol,
    side: row.side,
    entryReason: row.entry_reason,
    exitReason: row.exit_reason,
    notes: row.notes,
    confidenceScore: row.confidence_score != null ? Number(row.confidence_score) : null,
    screenshotUrl: row.screenshot_url,
    tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]'),
    lessonsLearned: row.lessons_learned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listJournal(req, res) {
  try {
    const userId = userIdFrom(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const params = [userId];
    let sql = `
      SELECT *
      FROM trade_journal
      WHERE user_id = ?
    `;

    if (req.query.symbol) {
      sql += ' AND symbol = ?';
      params.push(String(req.query.symbol).trim().toUpperCase());
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const [rows] = await db.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows.map(serialize) });
  } catch (err) {
    logger.error(`[TradeJournal] list: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function createJournal(req, res) {
  try {
    const userId = userIdFrom(req);
    const {
      tradeId = null,
      symbol,
      side = null,
      entryReason = null,
      exitReason = null,
      notes = null,
      confidenceScore = null,
      screenshotUrl = null,
      tags = [],
      lessonsLearned = null,
    } = req.body || {};

    if (!symbol || !String(symbol).trim()) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }

    const safeSide = side ? String(side).trim().toUpperCase() : null;
    if (safeSide && !['BUY', 'SELL'].includes(safeSide)) {
      return res.status(400).json({ success: false, error: 'side must be BUY or SELL' });
    }

    const score = confidenceScore === null || confidenceScore === ''
      ? null
      : Number(confidenceScore);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      return res.status(400).json({ success: false, error: 'confidenceScore must be between 0 and 100' });
    }

    const [rows] = await db.query(`
      INSERT INTO trade_journal
        (user_id, trade_id, symbol, side, entry_reason, exit_reason, notes,
         confidence_score, screenshot_url, tags, lessons_learned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
      RETURNING *
    `, [
      userId,
      tradeId,
      String(symbol).trim().toUpperCase(),
      safeSide,
      entryReason,
      exitReason,
      notes,
      score,
      screenshotUrl,
      JSON.stringify(normalizeTags(tags)),
      lessonsLearned,
    ]);

    res.status(201).json({ success: true, data: serialize(rows[0]) });
  } catch (err) {
    logger.error(`[TradeJournal] create: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function updateJournal(req, res) {
  try {
    const userId = userIdFrom(req);
    const id = req.params.id;
    const body = req.body || {};
    const score = body.confidenceScore === undefined || body.confidenceScore === null || body.confidenceScore === ''
      ? null
      : Number(body.confidenceScore);

    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      return res.status(400).json({ success: false, error: 'confidenceScore must be between 0 and 100' });
    }

    const [rows] = await db.query(`
      UPDATE trade_journal
      SET symbol = COALESCE(?, symbol),
          side = COALESCE(?, side),
          entry_reason = COALESCE(?, entry_reason),
          exit_reason = COALESCE(?, exit_reason),
          notes = COALESCE(?, notes),
          confidence_score = COALESCE(?, confidence_score),
          screenshot_url = COALESCE(?, screenshot_url),
          tags = COALESCE(?::jsonb, tags),
          lessons_learned = COALESCE(?, lessons_learned),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
      RETURNING *
    `, [
      body.symbol ? String(body.symbol).trim().toUpperCase() : null,
      body.side ? String(body.side).trim().toUpperCase() : null,
      body.entryReason ?? null,
      body.exitReason ?? null,
      body.notes ?? null,
      score,
      body.screenshotUrl ?? null,
      body.tags !== undefined ? JSON.stringify(normalizeTags(body.tags)) : null,
      body.lessonsLearned ?? null,
      id,
      userId,
    ]);

    if (!rows[0]) return res.status(404).json({ success: false, error: 'Journal entry not found' });
    res.json({ success: true, data: serialize(rows[0]) });
  } catch (err) {
    logger.error(`[TradeJournal] update: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function deleteJournal(req, res) {
  try {
    const userId = userIdFrom(req);
    const [, result] = await db.query('DELETE FROM trade_journal WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    res.json({ success: result.rowCount > 0 });
  } catch (err) {
    logger.error(`[TradeJournal] delete: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getJournalAnalytics(req, res) {
  try {
    const userId = userIdFrom(req);
    const [rows] = await db.query(`
      SELECT
        COUNT(*) AS total_entries,
        AVG(confidence_score) AS avg_confidence,
        COUNT(*) FILTER (WHERE side = 'BUY') AS buy_notes,
        COUNT(*) FILTER (WHERE side = 'SELL') AS sell_notes
      FROM trade_journal
      WHERE user_id = ?
    `, [userId]);

    const [tagRows] = await db.query(`
      SELECT tag, COUNT(*) AS count
      FROM trade_journal, jsonb_array_elements_text(tags) AS tag
      WHERE user_id = ?
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT 10
    `, [userId]);

    const summary = rows[0] || {};
    res.json({
      success: true,
      data: {
        totalEntries: Number(summary.total_entries || 0),
        avgConfidence: summary.avg_confidence != null ? Number(Number(summary.avg_confidence).toFixed(2)) : null,
        buyNotes: Number(summary.buy_notes || 0),
        sellNotes: Number(summary.sell_notes || 0),
        topTags: tagRows.map(r => ({ tag: r.tag, count: Number(r.count) })),
      },
    });
  } catch (err) {
    logger.error(`[TradeJournal] analytics: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  listJournal,
  createJournal,
  updateJournal,
  deleteJournal,
  getJournalAnalytics,
};
