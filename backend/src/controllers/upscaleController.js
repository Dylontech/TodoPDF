'use strict';

const pLimit = require('p-limit');
const sharp = require('sharp');

const config = require('../config');
const {
  upscaleImage,
  SUPPORTED_INPUT,
  OUTPUT_FORMATS,
  mimeFor,
  extFor
} = require('../services/conversion/upscale');
const { detectFileType, sanitizeFilename } = require('../utils/files');
const { httpError } = require('../utils/errors');
const { sendSingleFile } = require('../utils/response');
const {
  getInputBuffer,
  originalName,
  cleanupUploads,
  persistSingle
} = require('./helpers');

/**
 * ─────────────────────────────────────────────────────────────
 * Reescalar imagen — el primer endpoint MIXTO por escala:
 *
 *  - x2/x4 (sharp, instantáneo): disponible para TODOS. Invitados y
 *    usuarios reciben la imagen directamente desde RAM (nada toca disco,
 *    no se registra en el historial).
 *  - x8/x16 (Real-ESRGan IA): SOLO usuarios con sesión. El resultado se
 *    guarda en el volumen /data/storage y se registra en el historial;
 *    se responde { id } y la descarga usa /api/convert/:id/download.
 * ─────────────────────────────────────────────────────────────
 */

// La IA es pesada en CPU/RAM: su propio límite de concurrencia (1 por defecto).
const limit = pLimit(config.upscale.maxConcurrency);

// Escalas admitidas. Las de IA (≥8) requieren sesión.
const SCALES = [2, 4, 8, 16];
const AI_SCALES = [8, 16];

/** POST /api/upscale — reescala una imagen x2/x4 (libre) o x8/x16 (IA, con sesión). */
async function upscale(req, res, next) {
  try {
    const userId = req.session.userId || null;

    // 1) Escala: lista blanca. x8/x16 usan IA y requieren cuenta.
    const scale = Number(req.body.scale);
    if (!SCALES.includes(scale)) {
      throw httpError(400, `Escala no válida: "${req.body.scale}". Permitidas: ${SCALES.join(', ')}.`);
    }
    if (AI_SCALES.includes(scale) && !userId) {
      throw httpError(401, 'Inicia sesión para usar los escalados x8 y x16 con IA.');
    }

    // 2) Formato de salida: PNG (por defecto, sin pérdida), JPG o WebP.
    const format = String(req.body.format || 'png').toLowerCase().replace('.', '');
    if (!OUTPUT_FORMATS[format]) {
      throw httpError(400, `Formato de salida no soportado: "${req.body.format}". Permitidos: png, jpg, webp.`);
    }

    // 3) Entrada: buffer en RAM (invitado) o leído del temporal (autenticado).
    const inputBuffer = await getInputBuffer(req);
    const inputName = originalName(req);

    // Detecta el formato real por magic bytes (no por la extensión).
    const detected = await detectFileType(inputBuffer);
    if (!detected || !SUPPORTED_INPUT[detected.ext]) {
      throw httpError(400, 'Formato de imagen no soportado. Usa PNG, JPG, WebP, GIF o TIFF.');
    }

    // 4) Tope anti-OOM: limita los píxeles de SALIDA (x16 de una foto 12MP
    //    serían ~3 Gpx ≈ 12 GB de RAM al decodificar). 400 con el máximo
    //    admitido para la escala pedida.
    const meta = await sharp(inputBuffer).metadata();
    const pixels = (meta.width || 0) * (meta.height || 0);
    const outputPixels = pixels * scale * scale;
    if (outputPixels > config.upscale.maxOutputPixels) {
      const maxInput = Math.floor(config.upscale.maxOutputPixels / (scale * scale) / 1e6);
      const actual = (pixels / 1e6).toFixed(1);
      throw httpError(
        400,
        `La imagen es demasiado grande para x${scale}: ${actual} MP (máximo ${maxInput} MP a esta escala). Prueba una escala menor.`
      );
    }

    // 5) Procesado bajo límite de concurrencia.
    const out = await limit(() =>
      upscaleImage(inputBuffer, { scale, format, quality: config.conversion.jpegQuality })
    );

    // 6) FLUJO IA (x8/x16, implica sesión): persistir en el volumen + historial.
    if (AI_SCALES.includes(scale)) {
      const name = `reescalado-x${scale}-${Date.now()}.${extFor(format)}`;
      const id = await persistSingle(userId, out, 'image-upscale', inputName, name);
      return res.status(201).json({ id, name, size: out.length });
    }

    // 7) FLUJO DIRECTO (x2/x4): respuesta desde RAM, nada toca disco —
    //    incluso con sesión (decisión de diseño: solo la IA se persiste).
    const base = sanitizeFilename(inputName).replace(/\.(png|jpe?g|webp|gif|tiff?)$/i, '');
    return sendSingleFile(res, out, `${base}-x${scale}.${extFor(format)}`, mimeFor(format));
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

module.exports = { upscale };
