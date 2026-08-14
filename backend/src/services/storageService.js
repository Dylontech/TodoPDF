'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const config = require('../config');
const { sanitizeFilename } = require('../utils/files');

/**
 * ─────────────────────────────────────────────────────────────
 * Storage del flujo autenticado.
 * Los archivos convertidos se guardan en el volumen /data/storage
 * (montado en docker-compose) y se registran en el historial.
 * ─────────────────────────────────────────────────────────────
 */

const STORAGE = config.storage.storageDir;

/**
 * Crea un directorio único para un trabajo de conversión de un usuario.
 * Se usa para PDF → imágenes (varias páginas en una carpeta).
 */
async function createJobDir(userId) {
  const dir = path.join(
    STORAGE,
    String(userId),
    `job-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Escribe un Buffer en el directorio dado con nombre sanitizado.
 * Devuelve la ruta absoluta del archivo creado.
 */
async function writeFile(dir, name, buffer) {
  const safe = sanitizeFilename(name);
  const full = path.join(dir, safe);
  await fs.writeFile(full, buffer);
  return full;
}

/**
 * Escribe un único archivo en el directorio del usuario
 * (para imágenes → PDF: un único .pdf por conversión).
 */
async function writeUserFile(userId, name, buffer) {
  const dir = path.join(STORAGE, String(userId));
  await fs.mkdir(dir, { recursive: true });
  return writeFile(dir, name, buffer);
}

/**
 * Elimina los archivos temporales de subida (flujo autenticado).
 * Se invoca tras procesar la conversión, incluso en caso de error.
 */
async function cleanupTempFiles(files) {
  if (!files || files.length === 0) return;
  await Promise.all(
    files
      .filter((f) => f && f.path)
      .map((f) => fs.unlink(f.path).catch(() => {}))
  );
}

module.exports = { createJobDir, writeFile, writeUserFile, cleanupTempFiles };
