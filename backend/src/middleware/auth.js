'use strict';

const db = require('../config/db');

/**
 * Middlewares de autenticación basada en sesiones de servidor.
 * La sesión se guarda en MariaDB (express-mysql-session) y se envía
 * una cookie httpOnly al cliente.
 */

/** Exige sesión iniciada; si no, responde 401. */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Debes iniciar sesión para realizar esta acción.' });
}

/**
 * Adjunta el usuario actual (req.user) a partir de la sesión.
 * Si la sesión referencia un usuario inexistente, la destruye.
 */
async function attachUser(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  try {
    const user = await db('users').where({ id: req.session.userId }).first();
    if (!user) {
      return req.session.destroy(() => next());
    }
    // Solo exponemos campos seguros, nunca el hash
    req.user = { id: user.id, email: user.email };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth, attachUser };
