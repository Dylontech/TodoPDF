'use strict';

const bcrypt = require('bcrypt');
const db = require('../config/db');

/**
 * Servicio de autenticación: registro y login con bcrypt.
 * La sesión en sí se gestiona con express-session (cookies httpOnly).
 */

const SALT_ROUNDS = 10;

/**
 * Registra un nuevo usuario.
 * @returns {Promise<object|null>} Usuario creado o null si el email ya existe.
 */
async function register(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const exists = await db('users').where({ email: normalized }).first();
  if (exists) return null;

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [id] = await db('users').insert({ email: normalized, password_hash: passwordHash });
  return { id, email: normalized };
}

/**
 * Valida las credenciales de un usuario.
 * @returns {Promise<object|null>} { id, email } o null si no coinciden.
 */
async function login(email, password) {
  const normalized = String(email).trim().toLowerCase();
  const user = await db('users').where({ email: normalized }).first();
  if (!user) return null;

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  return { id: user.id, email: user.email };
}

module.exports = { register, login };
