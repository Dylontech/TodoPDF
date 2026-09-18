'use strict';

const config = require('../../config');
const { detectFileType } = require('../../utils/files');
const { httpError } = require('../../utils/errors');
const { runCommand } = require('../../utils/exec');

/**
 * ─────────────────────────────────────────────────────────────
 * Utilidades compartidas de PDF (100% RAM, sin tocar disco).
 * Se usan en PDF → imágenes, PDF → Office y en las herramientas
 * de manipulación (pdfTools.js).
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Valida que un Buffer sea un PDF real por sus "magic bytes".
 * No confía en la extensión declarada.
 */
async function validatePdf(pdfBuffer) {
  const type = await detectFileType(pdfBuffer);
  if (!type || type.mime !== 'application/pdf') {
    throw httpError(400, 'El archivo debe ser un PDF válido.');
  }
}

/**
 * Cuenta las páginas del PDF leyendo desde stdin (sin tocar disco).
 * Usa `pdfinfo` (poppler-utils, instalado en el Dockerfile) con entrada por stdin.
 */
async function countPages(pdfBuffer) {
  let stdout;
  try {
    ({ stdout } = await runCommand('pdfinfo', ['-'], pdfBuffer, { timeoutMs: 15_000 }));
  } catch (err) {
    // pdfinfo falla con "Incorrect password" cuando el PDF pide contraseña de
    // usuario. Sin esto, el usuario vería un 500 genérico en cada herramienta.
    if (isPasswordError(err)) throw passwordError();
    throw err;
  }
  const match = stdout.toString().match(/^Pages:\s+(\d+)/im);
  if (!match) throw httpError(400, 'No se pudo leer el número de páginas del PDF.');
  return parseInt(match[1], 10);
}

/** ¿El error de un binario se debe a que el PDF pide contraseña? */
function isPasswordError(err) {
  return /password/i.test((err && err.message) || '');
}

/** Error 400 estándar para PDFs protegidos con contraseña. */
function passwordError() {
  return httpError(
    400,
    'El PDF está protegido con contraseña. Quítale la protección (o guárdalo de nuevo sin contraseña) antes de convertirlo.'
  );
}

/**
 * Comprueba que el PDF se pueda abrir sin contraseña.
 *
 * `pdfinfo` informa "Encrypted: yes" cuando el PDF sólo tiene contraseña de
 * propietario (permisos), y falla con "Incorrect password" cuando exige la de
 * usuario. En ambos casos Ghostscript, LibreOffice y pdf-lib fallarían más
 * adelante con mensajes incomprensibles: mejor avisar aquí.
 */
async function assertPdfReadable(pdfBuffer) {
  try {
    const { stdout } = await runCommand('pdfinfo', ['-'], pdfBuffer, { timeoutMs: 15_000 });
    if (/^Encrypted:\s+yes/im.test(stdout.toString())) throw passwordError();
  } catch (err) {
    if (err.status === 400) throw err;
    if (isPasswordError(err)) throw passwordError();
    throw err;
  }
}

/**
 * Cuenta los caracteres de texto extraíbles del PDF (capa de texto).
 * Un PDF escaneado (sólo imágenes) devuelve 0: es la señal para hacer OCR.
 */
async function textLayerChars(pdfBuffer) {
  const { stdout } = await runCommand('pdftotext', ['-', '-'], pdfBuffer, { timeoutMs: 30_000 });
  return stdout.toString().replace(/\s+/g, '').length;
}

/**
 * Área (en píxeles) de la imagen más grande del PDF.
 * Una página escaneada suele ser UNA imagen de página completa (≥ 1 Mpx);
 * un PDF digital con un gráfico tiene imágenes mucho menores o ninguna.
 * Si `pdfimages` no está disponible, devuelve 0 (esa señal se ignora).
 */
async function maxImagePixels(pdfBuffer) {
  try {
    const { stdout } = await runCommand('pdfimages', ['-list', '-'], pdfBuffer, { timeoutMs: 30_000 });
    let max = 0;
    for (const line of stdout.toString().split('\n')) {
      const cols = line.trim().split(/\s+/);
      // Formato: page num type width height color comp bpc enc interp ...
      if (cols.length < 5 || !/^\d+$/.test(cols[0]) || cols[2] !== 'image') continue;
      const w = Number(cols[3]);
      const h = Number(cols[4]);
      if (Number.isFinite(w) && Number.isFinite(h)) max = Math.max(max, w * h);
    }
    return max;
  } catch {
    return 0;
  }
}

/**
 * ¿Es un PDF escaneado (sin capa de texto ÚTIL que importar)?
 *
 * Se combinan dos señales, porque un umbral absoluto de caracteres falla en
 * los dos sentidos:
 *
 *  1. Densidad de texto muy baja (< `TODOPDF_OCR_MIN_CHARS_PER_PAGE`): el PDF
 *     no tiene texto real. Cubre el escaneo limpio.
 *  2. Densidad baja (menos de 200 car./pág.) **y** una imagen de página
 *     completa (≥ ~1 Mpx): es un escaneo al que el escáner o el navegador le
 *     han añadido unas pocas letras (sello «CamScanner», la URL o la fecha de
 *     «imprimir a PDF»). Antes esto se colaba como "documento con texto" y se
 *     saltaba el OCR → el DOCX salía sin nada editable.
 *
 * Un PDF digital de verdad trae cientos o miles de caracteres por página, así
 * que no entra en ninguno de los dos casos y sigue por la ruta rápida.
 */
async function isScannedPdf(pdfBuffer, opts = {}) {
  const minChars =
    opts.minCharsPerPage || (config.ocr && config.ocr.minCharsPerPage) || 40;
  const scanImagePx = opts.scanImagePixels || 1_000_000;

  const chars = await textLayerChars(pdfBuffer);
  const pages = await countPages(pdfBuffer);
  const perPage = chars / Math.max(1, pages);

  if (perPage < minChars) return true;
  if (perPage < 200) return (await maxImagePixels(pdfBuffer)) >= scanImagePx;
  return false;
}

/**
 * Comprueba que el PDF no supere el límite de páginas configurado.
 * Lanza 400 si lo supera.
 */
async function assertPageCount(pdfBuffer, max = config.limits.maxPages) {
  const pages = await countPages(pdfBuffer);
  if (pages > max) {
    throw httpError(400, `El PDF supera el límite de ${max} páginas.`);
  }
  return pages;
}

/**
 * Parsea una especificación de páginas "1,3-5,8" (1-based, rangos inclusivos)
 * a un array de números de página, validando rango, formato y límite.
 * No se permiten duplicados (los ignora).
 *
 * @param {string} spec       Ej. "1,3-5,8"
 * @param {number} pageCount  Nº total de páginas del PDF (valida rango).
 * @param {object} [opts]     { max, label }
 * @returns {number[]} Páginas 1-based únicas y ordenadas según aparición.
 */
function parsePageList(spec, pageCount, opts = {}) {
  const { max = config.limits.maxPages, label = 'páginas' } = opts;
  const str = String(spec ?? '').trim();
  if (!str) throw httpError(400, `Debes indicar ${label}.`);
  const seen = new Set();
  const result = [];
  for (const token of str.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) {
      throw httpError(400, `Expresión de páginas inválida: "${t}". Usa p. ej. 1,3-5,8.`);
    }
    const a = parseInt(m[1], 10);
    const b = m[2] !== undefined ? parseInt(m[2], 10) : a;
    if (a < 1 || b < a || b > pageCount) {
      throw httpError(400, `La página "${t}" está fuera de rango (1-${pageCount}).`);
    }
    for (let p = a; p <= b; p++) {
      if (!seen.has(p)) {
        seen.add(p);
        result.push(p);
      }
    }
  }
  if (result.length === 0) throw httpError(400, `Debes indicar ${label}.`);
  if (result.length > max) {
    throw httpError(400, `El resultado supera el límite de ${max} páginas.`);
  }
  return result;
}

/**
 * Parsea una especificación de rangos "1-3,5,8-10" a un array de
 * pares [inicio, fin] inclusivos (1-based). Usado por "Dividir por rangos".
 *
 * @returns {Array<[number, number]>}
 */
function parseRanges(spec, pageCount) {
  const str = String(spec ?? '').trim();
  if (!str) throw httpError(400, 'Debes indicar los rangos.');
  const ranges = [];
  for (const token of str.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) {
      throw httpError(400, `Rango inválido: "${t}". Usa p. ej. 1-3,5,8-10.`);
    }
    const a = parseInt(m[1], 10);
    const b = m[2] !== undefined ? parseInt(m[2], 10) : a;
    if (a < 1 || b < a || b > pageCount) {
      throw httpError(400, `El rango "${t}" está fuera de rango (1-${pageCount}).`);
    }
    ranges.push([a, b]);
  }
  if (ranges.length === 0) throw httpError(400, 'Debes indicar los rangos.');
  return ranges;
}

module.exports = {
  validatePdf,
  countPages,
  assertPageCount,
  assertPdfReadable,
  textLayerChars,
  isScannedPdf,
  maxImagePixels,
  parsePageList,
  parseRanges
};
