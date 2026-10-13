'use strict';

const db = require('../config/db');
const lifecycle = require('../services/historyLifecycleService');

async function listUsers(req, res, next) {
  try {
    const users = await db('users')
      .select('id', 'email', 'role', 'status', 'banned_reason', 'banned_at', 'created_at')
      .orderBy('created_at', 'desc');
    const [conversionCounts, downloadCounts] = await Promise.all([
      db('conversions').select('user_id').count({ count: '*' }).groupBy('user_id'),
      db('downloads').select('user_id').count({ count: '*' }).groupBy('user_id')
    ]);
    const counts = new Map();
    for (const row of [...conversionCounts, ...downloadCounts]) {
      counts.set(row.user_id, (counts.get(row.user_id) || 0) + Number(row.count));
    }
    res.json({ users: users.map((user) => ({ ...user, history_count: counts.get(user.id) || 0 })) });
  } catch (err) {
    next(err);
  }
}

async function getUserHistory(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Usuario inválido.' });
    const user = await db('users').where({ id: userId }).select('id', 'email', 'role', 'status', 'banned_reason').first();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const [conversions, downloads] = await Promise.all([
      db('conversions').where({ user_id: userId }).select('id', 'type', 'input_filename as name', 'size', 'created_at'),
      db('downloads').where({ user_id: userId }).select('id', 'title as name', 'kind', 'ext', 'size', 'created_at')
    ]);
    res.json({
      user,
      history: [
        ...conversions.map((row) => ({ ...row, table: 'conversions', kind: 'conversion' })),
        ...downloads.map((row) => ({ ...row, table: 'downloads', kind: 'download' }))
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    });
  } catch (err) {
    next(err);
  }
}

async function deleteHistory(req, res, next) {
  try {
    if (!['conversions', 'downloads'].includes(req.params.table)) {
      return res.status(400).json({ error: 'Tipo de historial inválido.' });
    }
    await lifecycle.removeRow(req.params.table, req.params.id, { isAdmin: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function deleteUserHistory(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Usuario inválido.' });
    const deleted = await lifecycle.removeAllForUser(userId);
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/users/:userId/ban — suspende una cuenta. */
async function banUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Usuario inválido.' });
    const reason = String((req.body || {}).reason || '').trim().slice(0, 1000);

    const user = await db('users').where({ id: userId }).first();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.role === 'admin' || userId === req.user.id) {
      return res.status(400).json({ error: 'No puedes suspender cuentas de administrador.' });
    }
    if (user.status === 'banned') {
      return res.status(400).json({ error: 'La cuenta ya está suspendida.' });
    }

    await db('users').where({ id: userId }).update({
      status: 'banned',
      banned_at: db.fn.now(),
      banned_reason: reason || null,
      banned_by: req.user.id
    });
    await db('moderation_logs').insert({
      user_id: userId,
      admin_id: req.user.id,
      action: 'ban',
      reason: reason || null
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/users/:userId/unban — reactiva una cuenta suspendida. */
async function unbanUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ error: 'Usuario inválido.' });

    const user = await db('users').where({ id: userId }).first();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.status !== 'banned') {
      return res.status(400).json({ error: 'La cuenta no está suspendida.' });
    }

    await db('users').where({ id: userId }).update({
      status: 'active',
      banned_at: null,
      banned_reason: null,
      banned_by: null
    });
    await db('moderation_logs').insert({
      user_id: userId,
      admin_id: req.user.id,
      action: 'unban',
      reason: null
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, getUserHistory, deleteHistory, deleteUserHistory, banUser, unbanUser };