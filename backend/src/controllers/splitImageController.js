'use strict';

const pLimit = require('p-limit');

const config = require('../config');
const { splitImage } = require('../services/conversion/splitImage');
const { detectFileType, sanitizeFilename } = require('../utils/files');
const { httpError } = require('../utils/errors');
const {
  getInputBuffer,
  originalName,
  cleanupUploads,
  persistParts
} = require('./helpers');

const limit = pLimit(config.limits.maxConcurrency);
const SUPPORTED_INPUT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff']);

/** POST /api/split-image — divide una imagen en filas y columnas. */
async function splitImageController(req, res, next) {
  try {
    const inputBuffer = await getInputBuffer(req);
    const inputName = sanitizeFilename(originalName(req));
    const detected = await detectFileType(inputBuffer);
    if (!detected || !SUPPORTED_INPUT.has(detected.ext)) {
      throw httpError(400, 'Formato de imagen no soportado. Usa PNG, JPG, WebP, GIF o TIFF.');
    }

    const result = await limit(() => splitImage(inputBuffer, {
      columns: req.body.columns,
      rows: req.body.rows,
      inputExt: detected.ext
    }));
    const baseName = inputName.replace(/\.[^.]+$/, '') || 'imagen';
    const nameFn = (index) => {
      const part = result.parts[index];
      return `${baseName}-fila-${String(part.row).padStart(2, '0')}-columna-${String(part.column).padStart(2, '0')}.${result.ext}`;
    };
    const id = await persistParts(
      req.session.userId,
      result.parts.map((part) => part.buffer),
      'image-split',
      inputName,
      nameFn
    );

    return res.status(201).json({
      id,
      parts: result.parts.length,
      width: result.width,
      height: result.height,
      format: result.ext
    });
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

module.exports = { splitImageController };
