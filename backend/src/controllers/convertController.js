'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const archiver = require('archiver');
const pLimit = require('p-limit');

const config = require('../config');
const db = require('../config/db');
const { pdfToImages, extensionFor, mimeFor } = require('../services/conversion/pdfToImages');
const { imagesToPdf } = require('../services/conversion/imagesToPdf');
const officeService = require('../services/conversion/office');
const storage = require('../services/storageService');
const { httpError } = require('../utils/errors');
const { sanitizeFilename } = require('../utils/files');

/**
 * Controlador de conversiones.
 * Implementa los DOS flujos de privacidad:
 *
 *  1. INVITADO (sin sesión): todo ocurre en RAM (Buffers) y se responde
 *     el archivo directamente (ZIP/JPG/PDF). Nada toca el disco.
 *  2. AUTENTICADO (con sesión): el resultado se guarda en el volumen
 *     /data/storage y se registra en el historial de la BD. Se responde
 *     { id } y la descarga usa /api/convert/:id/download.
 */

// Límite de conversiones simultáneas (protege la RAM del servidor)
const limit = pLimit(config.limits.maxConcurrency);

// LibreOffice es muy pesado (~200-500 MB/instancia): su propio límite,
// independiente del global, para no agotar la RAM del servidor.
const officeLimit = pLimit(config.office.maxConcurrency);

/** Formatos de salida admitidos en PDF → imágenes. */
const PDF_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'bmp', 'gif'];

/** Formatos de salida admitidos en PDF → Office. */
const PDF_OFFICE_FORMATS = Object.keys(officeService.PDF_TARGET_FORMATS);

// ── Helpers privados ─────────────────────────────────────────

/** Obtiene el Buffer del primer archivo (invitado: RAM; autenticado: lee el temporal). */
async function getInputBuffer(files) {
  if (!files || files.length === 0) throw httpError(400, 'No se recibió ningún archivo.');
  const file = files[0];
  // Flujo autenticado: multer lo escribió en /data/tmp → se lee a memoria
  if (file.path) return fs.readFile(file.path);
  // Flujo invitado: ya está en RAM (multer memoryStorage)
  return file.buffer;
}

/** Normaliza y valida el formato de salida contra una lista blanca. */
function normalizeFormat(value, allowed) {
  const fmt = String(value || allowed[0]).toLowerCase().replace('.', '');
  if (!allowed.includes(fmt)) {
    throw httpError(400, `Formato no soportado: "${value}". Permitidos: ${allowed.join(', ')}.`);
  }
  return fmt;
}

/** Envía un archivo directo (una sola imagen). */
function sendSingleImage(res, buffer, baseName, ext) {
  res.setHeader('Content-Type', mimeFor(ext));
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}.${ext}"`);
  res.send(buffer);
}

/** Envía un ZIP construido en memoria (archiver → stream a la respuesta). */
function sendZip(res, buffers, baseName, ext) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => res.destroy(err));

  buffers.forEach((buf, i) => {
    archive.append(buf, { name: `${baseName}-pagina-${String(i + 1).padStart(2, '0')}.${ext}` });
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}.zip"`);
  archive.pipe(res);
  archive.finalize();
}

/** Elimina los temporales de subida (solo existen en el flujo autenticado). */
async function cleanupUploads(req) {
  await storage.cleanupTempFiles(req.files || []);
}

// ── Controladores ────────────────────────────────────────────

/** POST /api/convert/pdf-to-images */
async function convertPdfToImages(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const format = normalizeFormat(req.body.format, PDF_IMAGE_FORMATS);
    const quality = Math.min(100, Math.max(1, Number(req.body.quality) || config.conversion.jpegQuality));

    // 1) PDF en memoria (invitado) o leído del temporal (autenticado)
    const pdfBuffer = await getInputBuffer(req.files);

    // 2) Conversión 100% RAM con Ghostscript (stdin → stdout)
    const images = await limit(() => pdfToImages(pdfBuffer, { format, quality }));

    // 3) FLUJO AUTENTICADO: persistir en el volumen + historial
    if (userId) {
      const jobDir = await storage.createJobDir(userId);
      const ext = extensionFor(format);
      for (let i = 0; i < images.length; i++) {
        await storage.writeFile(jobDir, `pagina-${String(i + 1).padStart(2, '0')}.${ext}`, images[i]);
      }
      const [id] = await db('conversions').insert({
        user_id: userId,
        type: 'pdf-to-images',
        input_filename: sanitizeFilename(req.files[0].originalname),
        output_path: jobDir, // directorio con las páginas
        size: images.reduce((acc, b) => acc + b.length, 0)
      });
      return res.status(201).json({ id, pages: images.length, format });
    }

    // 4) FLUJO INVITADO: respuesta en memoria y liberación
    const base = sanitizeFilename(req.files[0].originalname).replace(/\.pdf$/i, '');
    const ext = extensionFor(format);
    if (images.length === 1) {
      // Una sola página → imagen directa
      sendSingleImage(res, images[0], base, ext);
    } else {
      // Varias páginas → ZIP en memoria
      sendZip(res, images, base, ext);
    }
    images.length = 0; // permite al GC liberar antes de finalizar la petición
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/images-to-pdf */
async function convertImagesToPdf(req, res, next) {
  try {
    const userId = req.session.userId || null;
    if (!req.files || req.files.length === 0) throw httpError(400, 'No se recibió ningún archivo.');

    // 1) Imágenes en memoria (invitado) o leídas del temporal (autenticado)
    const buffers = await Promise.all(req.files.map((f) => (f.path ? fs.readFile(f.path) : f.buffer)));

    // 2) Conversión 100% RAM (sharp + pdf-lib)
    const pdfBuffer = await limit(() => imagesToPdf(buffers));

    // 3) FLUJO AUTENTICADO: persistir en el volumen + historial
    if (userId) {
      const name = `convertido-${Date.now()}.pdf`;
      const outPath = await storage.writeUserFile(userId, name, pdfBuffer);
      const [id] = await db('conversions').insert({
        user_id: userId,
        type: 'images-to-pdf',
        input_filename: req.files.map((f) => sanitizeFilename(f.originalname)).join(', ').slice(0, 255),
        output_path: outPath,
        size: pdfBuffer.length
      });
      return res.status(201).json({ id, name });
    }

    // 4) FLUJO INVITADO: PDF en memoria
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="convertido.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/pdf-to-office */
async function convertPdfToOffice(req, res, next) {
  try {
    const userId = req.session.userId || null;
    const format = normalizeFormat(req.body.format, PDF_OFFICE_FORMATS);

    // 1) PDF en memoria (invitado) o leído del temporal (autenticado)
    const pdfBuffer = await getInputBuffer(req.files);

    // 2) Conversión con LibreOffice (temp aislado; concurrencia limitada)
    const out = await officeLimit(() => officeService.pdfToOffice(pdfBuffer, format));

    // 3) FLUJO AUTENTICADO: persistir en el volumen + historial
    if (userId) {
      const name = `convertido-${Date.now()}.${format}`;
      const outPath = await storage.writeUserFile(userId, name, out);
      const [id] = await db('conversions').insert({
        user_id: userId,
        type: `pdf-to-${format}`,
        input_filename: sanitizeFilename(req.files[0].originalname),
        output_path: outPath,
        size: out.length
      });
      return res.status(201).json({ id, name });
    }

    // 4) FLUJO INVITADO: respuesta directa (el temp aislado se borró en office.js)
    const base = sanitizeFilename(req.files[0].originalname).replace(/\.pdf$/i, '');
    res.setHeader('Content-Type', officeService.mimeForOffice(format));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.${format}"`);
    res.send(out);
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/convert/office-to-pdf */
async function convertOfficeToPdf(req, res, next) {
  try {
    const userId = req.session.userId || null;

    // 1) Documento Office en memoria (invitado) o leído del temporal (autenticado)
    const officeBuffer = await getInputBuffer(req.files);

    // 2) Conversión con LibreOffice (temp aislado; concurrencia limitada)
    const out = await officeLimit(() => officeService.officeToPdf(officeBuffer));

    // 3) FLUJO AUTENTICADO: persistir en el volumen + historial
    if (userId) {
      const name = `convertido-${Date.now()}.pdf`;
      const outPath = await storage.writeUserFile(userId, name, out);
      const [id] = await db('conversions').insert({
        user_id: userId,
        type: 'office-to-pdf',
        input_filename: sanitizeFilename(req.files[0].originalname),
        output_path: outPath,
        size: out.length
      });
      return res.status(201).json({ id, name });
    }

    // 4) FLUJO INVITADO: PDF en memoria
    const base = sanitizeFilename(req.files[0].originalname).replace(/\.[^.]+$/, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.pdf"`);
    res.send(out);
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** GET /api/convert/:id/download — descarga (solo el dueño de la conversión). */
async function download(req, res, next) {
  try {
    const userId = req.session.userId;
    const row = await db('conversions')
      .where({ id: req.params.id, user_id: userId })
      .first();

    if (!row) throw httpError(404, 'Conversión no encontrada.');

    const stat = await fs.stat(row.output_path).catch(() => null);
    if (!stat) throw httpError(404, 'El archivo ya no existe en el servidor.');

    if (stat.isDirectory()) {
      // PDF → imágenes: el directorio contiene las páginas → ZIP
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err) => res.destroy(err));
      archive.directory(row.output_path, false);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="conversion-${row.id}.zip"`);
      archive.pipe(res);
      return archive.finalize();
    }

    // Imágenes → PDF: archivo único
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(row.output_path)}"`);
    res.sendFile(row.output_path);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  convertPdfToImages,
  convertImagesToPdf,
  convertPdfToOffice,
  convertOfficeToPdf,
  download
};
