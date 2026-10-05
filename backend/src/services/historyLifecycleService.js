'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const db = require('../config/db');
const config = require('../config');
const { httpError } = require('../utils/errors');

const TABLES = new Set(['conversions', 'downloads']);

function assertTable(table) {
  if (!TABLES.has(table)) throw new Error(`Tabla de historial no permitida: ${table}`);
}

function assertOwnedPath(row) {
  const root = path.resolve(config.storage.storageDir);
  const userRoot = path.join(root, String(row.user_id));
  const target = path.resolve(row.output_path);
  if (target === userRoot || !target.startsWith(`${userRoot}${path.sep}`)) {
    throw new Error('La ruta del historial está fuera del almacenamiento del usuario.');
  }
  return target;
}

async function removeRow(table, id, { userId = null, isAdmin = false } = {}) {
  assertTable(table);
  const query = db(table).where({ id });
  if (!isAdmin) query.andWhere({ user_id: userId });
  const row = await query.first();
  if (!row) throw httpError(404, 'Entrada de historial no encontrada.');

  const target = assertOwnedPath(row);
  await fs.rm(target, { recursive: true, force: true });
  await db(table).where({ id: row.id }).delete();
  return row;
}

async function removeAllForUser(userId) {
  let deleted = 0;
  for (const table of TABLES) {
    const rows = await db(table).where({ user_id: userId }).select('id');
    for (const row of rows) {
      await removeRow(table, row.id, { userId });
      deleted += 1;
    }
  }
  return deleted;
}

async function deleteExpired({ now = new Date(), batchSize = 100 } = {}) {
  const cutoff = new Date(now.getTime() - config.retention.days * 24 * 60 * 60 * 1000);
  let deleted = 0;
  let failed = 0;

  for (const table of TABLES) {
    while (true) {
      const rows = await db(table)
        .where('created_at', '<', cutoff)
        .orderBy('id')
        .limit(batchSize)
        .select('id', 'user_id', 'output_path');
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          const target = assertOwnedPath(row);
          await fs.rm(target, { recursive: true, force: true });
          await db(table).where({ id: row.id }).delete();
          deleted += 1;
        } catch (err) {
          failed += 1;
          console.error(`[TodoPDF] No se pudo limpiar ${table}#${row.id}:`, err.message);
          await db(table).where({ id: row.id }).update({ created_at: new Date() });
        }
      }
    }
  }
  return { deleted, failed };
}

module.exports = { removeRow, removeAllForUser, deleteExpired };