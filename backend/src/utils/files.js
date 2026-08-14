'use strict';

const path = require('node:path');

/**
 * Nombre de archivo seguro: evita path traversal y caracteres peligrosos.
 * Se usa para nombres en el volumen y en el ZIP.
 */
function sanitizeFilename(name = '') {
  const base = path.basename(String(name));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Detecta el tipo real de un archivo por sus "magic bytes".
 * No confía en la extensión declarada (previene subidas maliciosas).
 *
 * file-type se importa dinámicamente porque su forma de exportación varía
 * según la versión/build:
 *   - ESM oficial  : export nombrado `fileTypeFromBuffer`.
 *   - Build CJS    : objeto `default` con método `fromBuffer`.
 */
async function detectFileType(buffer) {
  const mod = await import('file-type');
  const fn =
    mod.fileTypeFromBuffer ||
    (mod.default && (mod.default.fileTypeFromBuffer || mod.default.fromBuffer));
  return fn ? fn(buffer) : null;
}

module.exports = { sanitizeFilename, detectFileType };
