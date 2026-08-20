'use strict';

const pLimit = require('p-limit');

const config = require('../config');
const { inpaintImage, autoMask } = require('../services/conversion/inpaint');
const { detectFileType } = require('../utils/files');
const { httpError } = require('../utils/errors');
const {
  getInputBuffer,
  originalName,
  cleanupUploads,
  persistSingle
} = require('./helpers');

/**
 * Controlador de "Quitar objetos de imagen" (LaMa big-lama).
 *
 * Sección EXCLUSIVA para usuarios autenticados (requireAuth en la ruta):
 * el resultado se guarda en /data/storage/<usuario>, se registra en el
 * historial (tabla conversions, type 'image-inpaint') y se responde { id }.
 * La descarga usa la ruta genérica /api/convert/:id/download (solo dueño).
 */

// LaMa en CPU es pesado: concurrencia limitada (1 por defecto).
const limit = pLimit(config.inpaint.maxConcurrency);

// Formatos de imagen que big-lama puede decodificar (ext de file-type).
const SUPPORTED = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp'
};

/** POST /api/inpaint — borra los objetos marcados en la máscara. */
async function inpaint(req, res, next) {
  const userId = req.session.userId;
  try {
    const inputBuffer = await getInputBuffer(req);
    const inputName = originalName(req);
    const maskBuffer = await getInputBuffer(req, 'mask');

    // Detecta el formato real por magic bytes.
    const detected = await detectFileType(inputBuffer);
    if (!detected || !SUPPORTED[detected.ext]) {
      throw httpError(400, 'Formato de imagen no soportado. Usa PNG, JPG o WebP.');
    }

    const out = await limit(() => inpaintImage(inputBuffer, maskBuffer));

    const name = `quitar-objetos-${Date.now()}.png`;
    const id = await persistSingle(userId, out, 'image-inpaint', inputName, name);
    return res.status(201).json({ id, name, size: out.length });
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

/** POST /api/inpaint/auto-mask — genera una máscara automática por clic. */
async function autoMaskHandler(req, res, next) {
  try {
    const inputBuffer = await getInputBuffer(req);
    const x = Number.parseInt(req.body.x, 10);
    const y = Number.parseInt(req.body.y, 10);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      throw httpError(400, 'Coordenadas del clic inválidas.');
    }

    const mask = await limit(() => autoMask(inputBuffer, x, y));

    // Se devuelve la máscara como PNG para previsualizarla en el lienzo.
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', mask.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(mask);
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

module.exports = { inpaint, autoMask: autoMaskHandler };
