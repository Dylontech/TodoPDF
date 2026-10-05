'use strict';

const db = require('../config/db');
const lifecycle = require('../services/historyLifecycleService');
const config = require('../config');

/**
 * Controlador del historial de conversiones del usuario autenticado.
 */

/** GET /api/history */
async function getHistory(req, res, next) {
  try {
    const conversions = await db('conversions')
      .where({ user_id: req.session.userId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .select('id', 'type', 'input_filename', 'size', 'created_at');

    const downloads = await db('downloads')
      .where({ user_id: req.session.userId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .select('id', 'title', 'kind', 'ext', 'size', 'created_at');

    const expiresAt = (createdAt) =>
      new Date(new Date(createdAt).getTime() + config.retention.days * 24 * 60 * 60 * 1000).toISOString();
    res.json({
      history: [
        ...conversions.map((row) => ({ ...row, kind: 'conversion', name: row.input_filename, expires_at: expiresAt(row.created_at) })),
        ...downloads.map((row) => ({ ...row, kind: 'download', name: row.title, expires_at: expiresAt(row.created_at) }))
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    });
  } catch (err) {
    next(err);
  }
}

async function deleteConversion(req, res, next) {
  try {
    await lifecycle.removeRow('conversions', req.params.id, { userId: req.session.userId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function deleteAllHistory(req, res, next) {
  try {
    const deleted = await lifecycle.removeAllForUser(req.session.userId);
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHistory, deleteConversion, deleteAllHistory };
