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
  const { stdout } = await runCommand('pdfinfo', ['-'], pdfBuffer, { timeoutMs: 15_000 });
  const match = stdout.toString().match(/^Pages:\s+(\d+)/im);
  if (!match) throw httpError(400, 'No se pudo leer el número de páginas del PDF.');
  return parseInt(match[1], 10);
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

module.exports = { validatePdf, countPages, assertPageCount, parsePageList, parseRanges };
