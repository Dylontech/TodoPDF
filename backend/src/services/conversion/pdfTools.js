'use strict';

const { PDFDocument, degrees } = require('pdf-lib');
const config = require('../../config');
const { runCommand } = require('../../utils/exec');
const { httpError } = require('../../utils/errors');
const { validatePdf, parsePageList, parseRanges } = require('./pdfUtils');

/**
 * ─────────────────────────────────────────────────────────────
 * Herramientas de manipulación de PDF (100% RAM).
 * ─────────────────────────────────────────────────────────────
 *  - Estructura de páginas (split/extract/merge/insert/rotate/
 *    delete/organize) → pdf-lib.
 *  - Compresión y split por tamaño → Ghostscript pdfwrite
 *    (PDF por stdin, resultado por stdout: nada toca el disco).
 */

/** Perfiles de compresión admitidos (equivalen a -dPDFSETTINGS). */
const PDF_PROFILES = { screen: '/screen', ebook: '/ebook', printer: '/printer' };

/** Valida el PDF y lo abre con pdf-lib (memoria). */
async function loadPdf(buffer) {
  await validatePdf(buffer);
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    throw httpError(400, 'No se pudo abrir el PDF (¿está cifrado o corrupto?).');
  }
}

/** Serializa un documento pdf-lib a Buffer. */
async function savePdf(doc) {
  return Buffer.from(await doc.save());
}

/** Copia páginas (índices 0-based) de source a target y devuelve target. */
async function copyPages(source, target, indexes) {
  const pages = await target.copyPages(source, indexes);
  pages.forEach((p) => target.addPage(p));
  return target;
}

/**
 * Comprime un rango (o todo) del PDF con Ghostscript pdfwrite en RAM.
 * El PDF original entra por STDIN y el PDF comprimido sale por STDOUT.
 *
 * @param {Buffer} pdfBuffer
 * @param {object} [opts] { first?, last?, profile, timeoutMs }
 * @returns {Promise<Buffer>}
 */
function gsPdfwriteRange(pdfBuffer, opts = {}) {
  const profile = String(opts.profile || 'ebook').toLowerCase();
  if (!PDF_PROFILES[profile]) {
    throw httpError(400, `Perfil no soportado: "${profile}". Permitidos: screen, ebook, printer.`);
  }
  const args = [
    '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    `-dPDFSETTINGS=${PDF_PROFILES[profile]}`,
    '-dCompatibilityLevel=1.4'
  ];
  if (opts.first) args.push(`-dFirstPage=${opts.first}`);
  if (opts.last) args.push(`-dLastPage=${opts.last}`);
  args.push('-sOutputFile=-', '-');
  return runCommand('gs', args, pdfBuffer, { timeoutMs: opts.timeoutMs || config.conversion.gsTimeoutMs })
    .then((r) => r.stdout);
}

/**
 * Ajusta una página a los límites de páginas del PDF (protección anti-DoS).
 */
function assertLimit(n, max = config.limits.maxPages) {
  if (n > max) throw httpError(400, `El resultado supera el límite de ${max} páginas.`);
}

// ── Dividir ─────────────────────────────────────────────────

/** Divide el PDF en partes según rangos "1-3,5,8-10". Devuelve Buffer[] (una por rango). */
async function splitByRanges(pdfBuffer, rangesSpec) {
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const ranges = parseRanges(rangesSpec, pageCount);
  assertLimit(ranges.length);
  const parts = [];
  for (const [a, b] of ranges) {
    const target = await PDFDocument.create();
    const indexes = [];
    for (let p = a; p <= b; p++) indexes.push(p - 1);
    await copyPages(source, target, indexes);
    parts.push(await savePdf(target));
  }
  return parts;
}

/** Divide el PDF en partes de tamaño fijo (páginas por parte). Devuelve Buffer[]. */
async function splitEvery(pdfBuffer, chunkSize) {
  const size = Math.floor(Number(chunkSize));
  if (!Number.isInteger(size) || size < 1) {
    throw httpError(400, 'El número de páginas por parte debe ser un entero positivo.');
  }
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const parts = [];
  for (let start = 0; start < pageCount; start += size) {
    const end = Math.min(start + size, pageCount);
    const indexes = [];
    for (let p = start; p < end; p++) indexes.push(p);
    const target = await PDFDocument.create();
    await copyPages(source, target, indexes);
    parts.push(await savePdf(target));
  }
  assertLimit(parts.length);
  return parts;
}

/**
 * Divide el PDF en partes que no superen un tamaño objetivo (MB).
 *
 * Estrategia (conservadora): se mide el tamaño comprimido de cada página con
 * Ghostscript (1 run por página, tope maxPages) y se agrupan de forma greedy.
 * Como el tamaño conjunto tras comprimir comparte recursos (fuentes/imágenes),
 * la suma por-página SOBREESTIMA el resultado → las partes nunca superan el
 * objetivo. Cada parte final se emite con gs pdfwrite (resultado coherente).
 *
 * @param {Buffer} pdfBuffer
 * @param {number|string} targetMB  Tamaño objetivo en MB.
 * @returns {Promise<Buffer[]>}
 */
async function splitBySize(pdfBuffer, targetMB) {
  const target = Number(targetMB);
  if (!Number.isFinite(target) || target <= 0) {
    throw httpError(400, 'El tamaño objetivo debe ser un número positivo (MB).');
  }
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const targetBytes = target * 1024 * 1024;

  // 1) Tamaño comprimido por página (gs, 1 run/página — tope maxPages).
  const perPage = [];
  for (let p = 1; p <= pageCount; p++) {
    const buf = await gsPdfwriteRange(pdfBuffer, { first: p, last: p });
    perPage.push(buf.length);
  }

  // 2) Agrupación greedy conservadora.
  const groups = [];
  let current = [];
  let currentBytes = 0;
  for (let p = 0; p < pageCount; p++) {
    const size = perPage[p];
    if (current.length > 0 && currentBytes + size > targetBytes) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    // Si una página sola supera el target, se queda sola (no se puede dividir más).
    current.push(p);
    currentBytes += size;
  }
  if (current.length) groups.push(current);
  assertLimit(groups.length);

  // 3) Emite cada parte con gs pdfwrite (mismo perfil que la medición).
  const parts = [];
  for (const g of groups) {
    parts.push(await gsPdfwriteRange(pdfBuffer, { first: g[0] + 1, last: g[g.length - 1] + 1 }));
  }
  return parts;
}

// ── Extraer / Fusionar / Insertar ───────────────────────────

/** Extrae las páginas indicadas ("1,3-5") a un PDF nuevo. */
async function extractPages(pdfBuffer, pagesSpec) {
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const pages = parsePageList(pagesSpec, pageCount);
  assertLimit(pages.length);
  const target = await PDFDocument.create();
  await copyPages(source, target, pages.map((p) => p - 1));
  return savePdf(target);
}

/** Fusiona varios PDFs en uno solo, en el orden de los buffers. */
async function mergePdfs(buffers) {
  if (!buffers || buffers.length < 2) {
    throw httpError(400, 'Se necesitan al menos 2 archivos PDF para fusionar.');
  }
  const target = await PDFDocument.create();
  let total = 0;
  for (const buf of buffers) {
    const source = await loadPdf(buf);
    const n = source.getPageCount();
    total += n;
    assertLimit(total);
    await copyPages(source, target, Array.from({ length: n }, (_, i) => i));
  }
  return savePdf(target);
}

/**
 * Inserta las páginas de `insertBuffer` dentro de `baseBuffer`.
 * @param {Buffer} baseBuffer   PDF base.
 * @param {Buffer} insertBuffer PDF cuyas páginas se insertan.
 * @param {string} position     'start' | 'end' | 'after'
 * @param {number} [afterPage]  Página (1-based) tras la que insertar si position='after'.
 */
async function insertPages(baseBuffer, insertBuffer, position, afterPage) {
  const base = await loadPdf(baseBuffer);
  const insert = await loadPdf(insertBuffer);
  const baseCount = base.getPageCount();
  const insertCount = insert.getPageCount();
  assertLimit(baseCount + insertCount);

  const inserted = await base.copyPages(insert, Array.from({ length: insertCount }, (_, i) => i));

  let atIndex;
  if (position === 'start') {
    atIndex = 0;
  } else if (position === 'end') {
    atIndex = baseCount;
  } else if (position === 'after') {
    const after = Math.floor(Number(afterPage));
    if (!Number.isInteger(after) || after < 1 || after > baseCount) {
      throw httpError(400, `La posición "después de la página" debe estar entre 1 y ${baseCount}.`);
    }
    atIndex = after; // 0-based = justo después de la página `after` (1-based)
  } else {
    throw httpError(400, 'Posición inválida. Usa start, end o after.');
  }

  inserted.forEach((p, i) => base.insertPage(atIndex + i, p));
  return savePdf(base);
}

// ── Rotar / Eliminar / Organizar ────────────────────────────

/** Rota las páginas indicadas (o todas) en 90, 180 o 270 grados (acumulativo). */
async function rotatePages(pdfBuffer, rotation, pagesSpec) {
  const deg = Number(rotation);
  if (![90, 180, 270].includes(deg)) {
    throw httpError(400, 'La rotación debe ser 90, 180 o 270 grados.');
  }
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const all = !pagesSpec || String(pagesSpec).trim() === '' || String(pagesSpec).trim().toLowerCase() === 'all';
  const pages = all
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : parsePageList(pagesSpec, pageCount);
  for (const p of pages) {
    const page = source.getPage(p - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + deg) % 360));
  }
  return savePdf(source);
}

/** Elimina las páginas indicadas ("2,4-6"). No puede quedar el PDF vacío. */
async function deletePages(pdfBuffer, pagesSpec) {
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const pages = parsePageList(pagesSpec, pageCount);
  if (pages.length >= pageCount) {
    throw httpError(400, 'No se pueden eliminar todas las páginas del PDF.');
  }
  const toRemove = new Set(pages.map((p) => p - 1));
  for (let i = pageCount - 1; i >= 0; i--) {
    if (toRemove.has(i)) source.removePage(i);
  }
  return savePdf(source);
}

/** Reordena las páginas según "3,1,2,5,4" (debe incluir todas). */
async function reorderPages(pdfBuffer, orderSpec) {
  const source = await loadPdf(pdfBuffer);
  const pageCount = source.getPageCount();
  const order = parsePageList(orderSpec, pageCount);
  if (order.length !== pageCount) {
    throw httpError(400, `El nuevo orden debe incluir las ${pageCount} páginas del PDF.`);
  }
  const target = await PDFDocument.create();
  await copyPages(source, target, order.map((p) => p - 1));
  return savePdf(target);
}

// ── Comprimir ───────────────────────────────────────────────

/** Comprime el PDF con Ghostscript pdfwrite según el perfil. */
async function compressPdf(pdfBuffer, profile) {
  await validatePdf(pdfBuffer);
  return gsPdfwriteRange(pdfBuffer, { profile });
}

module.exports = {
  splitByRanges,
  splitEvery,
  splitBySize,
  extractPages,
  mergePdfs,
  insertPages,
  rotatePages,
  deletePages,
  reorderPages,
  compressPdf,
  PDF_PROFILES
};
