'use strict';

const pLimit = require('p-limit');

const config = require('../config');
const { vectorizeImage } = require('../services/conversion/vectorize');
const { detectFileType } = require('../utils/files');
const { httpError } = require('../utils/errors');
const {
  getInputBuffer,
  originalName,
  cleanupUploads,
  persistSingle
} = require('./helpers');

// vtracer es ligero en CPU/RAM pero limitamos la concurrencia (1 por defecto).
const limit = pLimit(config.vectorize.maxConcurrency);

// Formatos de imagen que vtracer puede decodificar (ext de file-type → img_format).
const SUPPORTED = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  bmp: 'bmp'
};

/** POST /api/vectorize — vectoriza una imagen a SVG (color o blanco y negro). */
async function vectorize(req, res, next) {
  const userId = req.session.userId;
  try {
    const inputBuffer = await getInputBuffer(req);
    const inputName = originalName(req);

    // Detecta el formato real por magic bytes y lo mapea al de vtracer.
    const detected = await detectFileType(inputBuffer);
    const imgFormat = detected && SUPPORTED[detected.ext];
    if (!imgFormat) {
      throw httpError(400, 'Formato de imagen no soportado. Usa PNG, JPG, WebP, GIF o BMP.');
    }

    // Modo de vectorización: 'color' (por defecto) o 'binary' (blanco y negro).
    const mode = req.body.mode === 'binary' ? 'binary' : 'color';

    const out = await limit(() => vectorizeImage(inputBuffer, { imgFormat, mode }));

    const name = `vectorizado-${Date.now()}.svg`;
    const id = await persistSingle(userId, out, 'image-to-vector', inputName, name);
    return res.status(201).json({ id, name, size: out.length });
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

module.exports = { vectorize };
