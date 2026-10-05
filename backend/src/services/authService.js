'use strict';

const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const db = require('../config/db');
const config = require('../config');

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
  const role = config.admin.emails.includes(normalized) ? 'admin' : 'user';
  const [id] = await db('users').insert({ email: normalized, password_hash: passwordHash, role });
  return { id, email: normalized, role };
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

  return { id: user.id, email: user.email, role: user.role || 'user' };
}

/** Busca, vincula o crea el usuario asociado a una cuenta Google verificada. */
async function loginWithGoogle(email, googleSub) {
  const normalized = String(email).trim().toLowerCase();
  const linked = await db('users').where({ google_sub: googleSub }).first();
  if (linked) {
    if (linked.email !== normalized) throw new Error('La identidad de Google ya está vinculada a otra cuenta.');
    return { id: linked.id, email: linked.email, role: linked.role || 'user' };
  }

  const existing = await db('users').where({ email: normalized }).first();
  if (existing) {
    if (existing.google_sub && existing.google_sub !== googleSub) {
      throw new Error('El email ya está vinculado a otra identidad de Google.');
    }
    await db('users').where({ id: existing.id }).update({ google_sub: googleSub });
    return { id: existing.id, email: existing.email, role: existing.role || 'user' };
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);
  const role = config.admin.emails.includes(normalized) ? 'admin' : 'user';
  try {
    const [id] = await db('users').insert({
      email: normalized,
      password_hash: passwordHash,
      google_sub: googleSub,
      role
    });
    return { id, email: normalized, role };
  } catch (err) {
    if (!err || err.code !== 'ER_DUP_ENTRY') throw err;

    // Otro login pudo crear la misma identidad entre el SELECT y el INSERT.
    const concurrent = await db('users').where({ google_sub: googleSub }).orWhere({ email: normalized }).first();
    if (!concurrent) throw err;
    if (concurrent.email !== normalized || (concurrent.google_sub && concurrent.google_sub !== googleSub)) {
      throw new Error('La identidad de Google ya está vinculada a otra cuenta.');
    }
    if (!concurrent.google_sub) {
      await db('users').where({ id: concurrent.id }).update({ google_sub: googleSub });
    }
    return { id: concurrent.id, email: concurrent.email, role: concurrent.role || 'user' };
  }
}

async function promoteConfiguredAdmins() {
  if (config.admin.emails.length === 0) return 0;
  return db('users').whereIn('email', config.admin.emails).update({ role: 'admin' });
}

module.exports = { register, login, loginWithGoogle, promoteConfiguredAdmins };
