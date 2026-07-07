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

    const [, insertResult] = await db.query(`
      INSERT INTO trade_journal
        (user_id, trade_id, symbol, side, entry_reason, exit_reason, notes,
         confidence_score, screenshot_url, tags, lessons_learned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    // No RETURNING in MySQL/TiDB — fetch the row we just wrote by its new id.
    const [rows] = await db.query('SELECT * FROM trade_journal WHERE id = ? LIMIT 1', [insertResult.insertId]);
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

    await db.query(`
      UPDATE trade_journal
      SET symbol = COALESCE(?, symbol),
          side = COALESCE(?, side),
          entry_reason = COALESCE(?, entry_reason),
          exit_reason = COALESCE(?, exit_reason),
          notes = COALESCE(?, notes),
          confidence_score = COALESCE(?, confidence_score),
          screenshot_url = COALESCE(?, screenshot_url),
          tags = COALESCE(?, tags),
          lessons_learned = COALESCE(?, lessons_learned),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
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

    // affectedRows is 0 if no row matched id+user_id (not found / not yours).
    // Note: MySQL/TiDB only counts a row as "affected" if a value actually
    // changed — if the update was a no-op (identical values), affectedRows
    // can be 0 even though the row exists. Re-check existence explicitly.
    const [rows] = await db.query('SELECT * FROM trade_journal WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
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
    res.json({ success: result.affectedRows > 0 });
  } catch (err) {
    logger.error(`[TradeJournal] delete: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getJournalAnalytics(req, res) {
  try {
    const userId = userIdFrom(req);
    // FILTER (WHERE ...) is Postgres-only — MySQL/TiDB equivalent is a
    // conditional SUM/CASE.
    const [rows] = await db.query(`
      SELECT
        COUNT(*) AS total_entries,
        AVG(confidence_score) AS avg_confidence,
        SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) AS buy_notes,
        SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) AS sell_notes
      FROM trade_journal
      WHERE user_id = ?
    `, [userId]);

    // jsonb_array_elements_text() (Postgres) has no reliable MySQL/TiDB
    // equivalent — JSON_TABLE() exists in MySQL 8 but isn't consistently
    // available across TiDB versions. Aggregate tags in application code
    // instead: portable, and journal counts are small enough this is cheap.
    const [tagSource] = await db.query(
      `SELECT tags FROM trade_journal WHERE user_id = ? AND tags IS NOT NULL`,
      [userId]
    );
    const tagCounts = new Map();
    for (const row of tagSource) {
      const tags = Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]');
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const summary = rows[0] || {};
    res.json({
      success: true,
      data: {
        totalEntries: Number(summary.total_entries || 0),
        avgConfidence: summary.avg_confidence != null ? Number(Number(summary.avg_confidence).toFixed(2)) : null,
        buyNotes: Number(summary.buy_notes || 0),
        sellNotes: Number(summary.sell_notes || 0),
        topTags,
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
