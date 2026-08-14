'use strict';

const authService = require('../services/authService');
const { httpError } = require('../utils/errors');

/**
 * Controlador de autenticación.
 * Gestiona el registro y login; la sesión se persiste en MariaDB
 * (express-mysql-session) y se envía una cookie httpOnly al cliente.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/auth/register */
async function register(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!email || !EMAIL_RE.test(String(email))) {
      throw httpError(400, 'Introduce un email válido.');
    }
    if (!password || String(password).length < 8) {
      throw httpError(400, 'La contraseña debe tener al menos 8 caracteres.');
    }

    const user = await authService.register(email, password);
    if (!user) {
      throw httpError(409, 'Ya existe una cuenta con ese email.');
    }

    // Inicia sesión automáticamente tras el registro
    req.session.userId = user.id;
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/login */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw httpError(400, 'Email y contraseña son obligatorios.');
    }

    const user = await authService.login(email, password);
    if (!user) {
      throw httpError(401, 'Credenciales incorrectas.');
    }

    // Regenera la sesión para evitar fijación de sesión
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.json({ user });
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/logout */
function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('todopdf.sid');
    res.json({ ok: true });
  });
}

/** GET /api/auth/me */
function me(req, res) {
  if (!req.user) return res.status(401).json({ user: null });
  res.json({ user: req.user });
}

module.exports = { register, login, logout, me };
