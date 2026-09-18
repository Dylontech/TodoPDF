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

// ── Contenedores CFB (MS Office 97-2003) ─────────────────────
// Los .doc, .xls y .ppt comparten el MISMO contenedor binario
// (Compound File Binary), así que file-type los reporta todos como
// 'application/x-cfb' sin distinguirlos. Para elegir el filtro de
// importación correcto en LibreOffice hay que mirar DENTRO del
// contenedor (CLSID de la raíz o nombre del stream principal).

/** Cabecera de un contenedor CFB. */
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** CLSID de la entrada raíz por aplicación (hex, 16 bytes). */
const CFB_ROOT_CLSIDS = {
  doc: ['0609020000000000c000000000000046'], // Word.Document.8
  xls: [
    '2008020000000000c000000000000046', // Excel.Sheet.8
    '1908020000000000c000000000000046' // Excel.Workbook
  ],
  ppt: ['108d81649b4fcf1186ea00aa00b929e8'] // PowerPoint.Show.8
};

/** Nombres de stream internos (UTF-16LE) como respaldo del CLSID. */
const CFB_STREAM_NAMES = {
  doc: ['WordDocument'],
  xls: ['Workbook', 'Book'],
  ppt: ['PowerPoint Document']
};

/**
 * Distingue el tipo de documento de un contenedor CFB (doc/xls/ppt).
 *
 * 1) CLSID de la entrada raíz del directorio CFB. El directorio empieza en
 *    el sector indicado por el campo `firstDirSector` de la cabecera, y el
 *    sector k ocupa el offset (k + 1) * sectorSize (el 0 es la cabecera).
 * 2) Respaldo: búsqueda de los nombres de stream conocidos (algunos
 *    generadores dejan el CLSID de la raíz a cero).
 *
 * @param {Buffer} buffer Contenido del archivo.
 * @returns {'doc'|'xls'|'ppt'|null} null si no es un CFB reconocible.
 */
function sniffCfbKind(buffer) {
  if (!buffer || buffer.length < 512) return null;
  if (!buffer.subarray(0, 8).equals(CFB_MAGIC)) return null;

  const sectorShift = buffer.readUInt16LE(30);
  const sectorSize = 1 << (sectorShift === 9 || sectorShift === 12 ? sectorShift : 9);
  const dirOffset = (buffer.readUInt32LE(48) + 1) * sectorSize;

  // Entrada raíz: CLSID en el offset +80 de la entrada (128 bytes cada una)
  if (dirOffset + 96 <= buffer.length) {
    const clsid = buffer.subarray(dirOffset + 80, dirOffset + 96).toString('hex');
    for (const [kind, ids] of Object.entries(CFB_ROOT_CLSIDS)) {
      if (ids.includes(clsid)) return kind;
    }
  }

  for (const [kind, names] of Object.entries(CFB_STREAM_NAMES)) {
    for (const name of names) {
      if (buffer.indexOf(Buffer.from(name, 'utf16le')) !== -1) return kind;
    }
  }
  return null;
}

module.exports = { sanitizeFilename, detectFileType, sniffCfbKind };
