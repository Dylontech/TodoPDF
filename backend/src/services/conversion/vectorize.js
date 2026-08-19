'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../../config');
const { runCommand } = require('../../utils/exec');
const { httpError } = require('../../utils/errors');

const SCRIPT = config.vectorize.scriptPath;

/**
 * Vectoriza una imagen a SVG usando vtracer (script Python, patrón ghostscript).
 * @param {Buffer} inputBuffer Imagen original (PNG/JPG/WebP/GIF/BMP, ...).
 * @param {object} [opts] Opciones { imgFormat, mode }.
 * @returns {Promise<Buffer>} SVG vectorial.
 */
async function vectorizeImage(inputBuffer, opts = {}) {
  const imgFormat = opts.imgFormat || 'png';
  const mode = opts.mode || config.vectorize.mode;

  const dir = path.join(config.storage.tempDir, 'vectorize');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `out-${Date.now()}-${Math.round(Math.random() * 1e6)}.svg`);

  try {
    await runCommand(
      config.vectorize.pythonPath,
      [SCRIPT, outPath, imgFormat, mode],
      inputBuffer,
      { timeoutMs: config.vectorize.timeoutMs }
    );

    const out = await fs.readFile(outPath);
    if (!out || out.length === 0) {
      throw httpError(500, 'El procesamiento de imagen no devolvió ningún resultado.');
    }
    return out;
  } finally {
    // El archivo temporal se borra SIEMPRE, incluso si falla el procesado.
    await fs.unlink(outPath).catch(() => {});
  }
}

module.exports = { vectorizeImage };
