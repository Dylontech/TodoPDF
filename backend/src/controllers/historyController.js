'use strict';

const db = require('../config/db');

/**
 * Controlador del historial de conversiones del usuario autenticado.
 */

/** GET /api/history */
async function getHistory(req, res, next) {
  try {
    const rows = await db('conversions')
      .where({ user_id: req.session.userId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .select('id', 'type', 'input_filename', 'size', 'created_at');

    // Se omite output_path: es interno y solo se usa en /download
    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHistory };
