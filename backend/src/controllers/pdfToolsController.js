'use strict';

const fs = require('node:fs/promises');
const pLimit = require('p-limit');

const config = require('../config');
const db = require('../config/db');
const tools = require('../services/conversion/pdfTools');
const { validatePdf, countPages } = require('../services/conversion/pdfUtils');
const storage = require('../services/storageService');
const { httpError } = require('../utils/errors');
const { sanitizeFilename } = require('../utils/files');
const { sendSingleFile, sendZip } = require('../utils/response');

/**
 * Controlador de herramientas de manipulación de PDF (dividir, extraer,
 * fusionar, insertar, rotar, eliminar, organizar, comprimir + info).
 *
 * Implementa los DOS flujos de privacidad igual que convertController:
 *  1. INVITADO: todo en RAM (Buffers) y se responde el archivo (PDF/ZIP).
 *  2. AUTENTICADO: resultado en el volumen /data/storage + historial; se
 *     responde { id } y la descarga usa /api/convert/:id/download.
 */

// Límite de conversiones simultáneas (protege la RAM del servidor).
const limit = pLimit(config.limits.maxConcurrency);

// ── Helpers privados ─────────────────────────────────────────

/** Devuelve los archivos de un campo (funciona con array u objeto de multer). */
function filesOf(req, field) {
  const files = req.files;
  if (!files) return [];
  return Array.isArray(files) ? files : files[field] || [];
}

/** Buffer del primer archivo de un campo. */
async function getInputBuffer(req, field = 'files') {
  const files = filesOf(req, field);
  if (files.length === 0) throw httpError(400, 'No se recibió ningún archivo.');
  const file = files[0];
  return file.path ? fs.readFile(file.path) : file.buffer;
}

/** Buffers de todos los archivos de un campo (mantiene el orden). */
async function getInputBuffers(req, field = 'files') {
  const files = filesOf(req, field);
  if (files.length === 0) throw httpError(400, 'No se recibió ningún archivo.');
  return Promise.all(files.map((f) => (f.path ? fs.readFile(f.path) : f.buffer)));
}

/** Nombre original del primer archivo de un campo. */
function originalName(req, field = 'files') {
  const files = filesOf(req, field);
  return files.length > 0 ? files[0].originalname : 'documento';
}

/** Limpia los temporales de subida (flujo autenticado). */
async function cleanupUploads(req) {
  const files = Array.isArray(req.files)
    ? req.files
    : Object.values(req.files || {}).flat();
  await storage.cleanupTempFiles(files);
}

/** Nombre de salida único para el flujo autenticado. */
function outputName() {
  return `convertido-${Date.now()}.pdf`;
}

/** Persiste varios archivos (split) en un jobDir y registra en el historial. */
async function persistParts(userId, buffers, type, inputName, nameFn) {
  const jobDir = await storage.createJobDir(userId);
  for (let i = 0; i < buffers.length; i++) {
    await storage.writeFile(jobDir, nameFn(i), buffers[i]);
  }
  const [id] = await db('conversions').insert({
    user_id: userId,
    type,
    input_filename: inputName,
    output_path: jobDir,
    size: buffers.reduce((acc, b) => acc + b.length, 0)
  });
  return id;
}

/** Persiste un único archivo y registra en el historial. */
async function persistSingle(userId, buffer, type, inputName, name) {
  const outPath = await storage.writeUserFile(userId, name, buffer);
  const [id] = await db('conversions').insert({
    user_id: userId,
    type,
    input_filename: inputName,
    output_path: outPath,
    size: buffer.length
  });
  return id;
}

// ── Controladores ────────────────────────────────────────────

/** POST /api/convert/pdf-info → { pages } (para UI de organizar/insertar). */
async function pdfInfo(req, res, next) {
  try {
    const pdfBuffer = await getInputBuffer(req);
    await validatePdf(pdfBuffer);
    const pages = await limit(() => countPages(pdfBuffer));
    res.json({ pages });
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-split — modos: ranges | every | pages | size. */
async function pdfSplit(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const mode = String(req.body.mode || 'ranges').toLowerCase();
    const pdfBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const base = inputName.replace(/\.pdf$/i, '');

    let parts;
    let nameFn;
    if (mode === 'ranges') {
      parts = await limit(() => tools.splitByRanges(pdfBuffer, req.body.ranges));
      nameFn = (i) => `parte-${String(i + 1).padStart(2, '0')}.pdf`;
    } else if (mode === 'every') {
      parts = await limit(() => tools.splitEvery(pdfBuffer, req.body.every));
      nameFn = (i) => `parte-${String(i + 1).padStart(2, '0')}.pdf`;
    } else if (mode === 'pages') {
      parts = await limit(() => tools.splitEvery(pdfBuffer, 1));
      nameFn = (i) => `pagina-${String(i + 1).padStart(2, '0')}.pdf`;
    } else if (mode === 'size') {
      parts = await limit(() => tools.splitBySize(pdfBuffer, req.body.sizeMB));
      nameFn = (i) => `parte-${String(i + 1).padStart(2, '0')}.pdf`;
    } else {
      throw httpError(400, 'Modo de división no soportado. Usa ranges, every, pages o size.');
    }

    if (userId) {
      const id = await persistParts(userId, parts, 'pdf-split', inputName, nameFn);
      return res.status(201).json({ id, parts: parts.length });
    }

    // FLUJO INVITADO: una parte → PDF directo; varias → ZIP en memoria.
    if (parts.length === 1) {
      return sendSingleFile(res, parts[0], `${base}.pdf`, 'application/pdf');
    }
    sendZip(res, { buffers: parts, baseName: base, nameFn });
    parts.length = 0;
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-extract — páginas "1,3-5" → un único PDF. */
async function pdfExtract(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const pdfBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const out = await limit(() => tools.extractPages(pdfBuffer, req.body.pages));

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-extract', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, `${inputName.replace(/\.pdf$/i, '')}-extraido.pdf`, 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-merge — 2+ PDFs → uno, en orden de subida. */
async function pdfMerge(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const buffers = await getInputBuffers(req);
    const inputName = filesOf(req, 'files')
      .map((f) => sanitizeFilename(f.originalname))
      .join(', ')
      .slice(0, 255);
    const out = await limit(() => tools.mergePdfs(buffers));

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-merge', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, 'fusionado.pdf', 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-insert — base (files) + insert + position. */
async function pdfInsert(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const baseBuffer = await getInputBuffer(req, 'files');
    const insertBuffer = await getInputBuffer(req, 'insert');
    const inputName = sanitizeFilename(originalName(req, 'files'));
    const out = await limit(() =>
      tools.insertPages(baseBuffer, insertBuffer, req.body.position, req.body.after)
    );

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-insert', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, `${inputName.replace(/\.pdf$/i, '')}-insertado.pdf`, 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-rotate — degrees 90|180|270 (+ páginas opcionales). */
async function pdfRotate(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const pdfBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const out = await limit(() => tools.rotatePages(pdfBuffer, req.body.degrees, req.body.pages));

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-rotate', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, `${inputName.replace(/\.pdf$/i, '')}-rotado.pdf`, 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-delete — elimina las páginas indicadas. */
async function pdfDelete(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const pdfBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const out = await limit(() => tools.deletePages(pdfBuffer, req.body.pages));

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-delete', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, `${inputName.replace(/\.pdf$/i, '')}-sin-paginas.pdf`, 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-organize — reordena páginas según order. */
async function pdfOrganize(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const pdfBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const out = await limit(() => tools.reorderPages(pdfBuffer, req.body.order));

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-organize', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, `${inputName.replace(/\.pdf$/i, '')}-reordenado.pdf`, 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-compress — perfil screen|ebook|printer. */
async function pdfCompress(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const pdfBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const out = await limit(() => tools.compressPdf(pdfBuffer, req.body.profile));

    if (userId) {
      const name = outputName();
      const id = await persistSingle(userId, out, 'pdf-compress', inputName, name);
      return res.status(201).json({ id, name });
    }
    return sendSingleFile(res, out, `${inputName.replace(/\.pdf$/i, '')}-comprimido.pdf`, 'application/pdf');
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

module.exports = {
  pdfInfo,
  pdfSplit,
  pdfExtract,
  pdfMerge,
  pdfInsert,
  pdfRotate,
  pdfDelete,
  pdfOrganize,
  pdfCompress
};
