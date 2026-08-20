'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../../config');
const { runCommand } = require('../../utils/exec');
const { httpError } = require('../../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Quitar objetos de imagen con IA (LaMa / big-lama ONNX).
 *
 * Mismo patrón que rembg/ghostscript: se invoca un script Python por pipes.
 * La imagen original entra por stdin; la máscara (blanco = zona a rellenar)
 * se escribe en un temporal y el script devuelve el PNG resultante.
 * ─────────────────────────────────────────────────────────────
 */

const SCRIPT = config.inpaint.scriptPath;
const AUTO_MASK_SCRIPT = config.inpaint.autoMaskScriptPath;

/**
 * @param {Buffer} inputBuffer Imagen original (PNG/JPG/WebP, ...).
 * @param {Buffer} maskBuffer Máscara PNG (blanco sobre negro).
 * @param {object} [opts] Opciones { modelPath }.
 * @returns {Promise<Buffer>} PNG con los objetos de la máscara eliminados.
 */
async function inpaintImage(inputBuffer, maskBuffer, opts = {}) {
  const modelPath = opts.modelPath || config.inpaint.modelPath;

  const dir = path.join(config.storage.tempDir, 'inpaint');
  await fs.mkdir(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const outPath = path.join(dir, `out-${stamp}.png`);
  const maskPath = path.join(dir, `mask-${stamp}.png`);

  try {
    await fs.writeFile(maskPath, maskBuffer);
    await runCommand(
      config.inpaint.pythonPath,
      [SCRIPT, outPath, maskPath, modelPath],
      inputBuffer,
      { timeoutMs: config.inpaint.timeoutMs }
    );

    const out = await fs.readFile(outPath);
    if (!out || out.length === 0) {
      throw httpError(500, 'El procesamiento de imagen no devolvió ningún resultado.');
    }
    return out;
  } finally {
    // Los temporales se borran SIEMPRE, incluso si falla el procesado.
    await fs.unlink(outPath).catch(() => {});
    await fs.unlink(maskPath).catch(() => {});
  }
}

/**
 * Genera una máscara automática por clic (flood fill + fallback u2net).
 * @param {Buffer} inputBuffer Imagen original.
 * @param {number} x Columna del clic (px, coordenadas de la imagen original).
 * @param {number} y Fila del clic (px).
 * @returns {Promise<Buffer>} PNG de máscara (blanco sobre negro).
 */
async function autoMask(inputBuffer, x, y) {
  const dir = path.join(config.storage.tempDir, 'inpaint');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `auto-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);

  try {
    await runCommand(
      config.inpaint.pythonPath,
      [AUTO_MASK_SCRIPT, outPath, String(x), String(y)],
      inputBuffer,
      { timeoutMs: config.inpaint.timeoutMs }
    );

    const out = await fs.readFile(outPath);
    if (!out || out.length === 0) {
      throw httpError(500, 'La generación de máscara no devolvió ningún resultado.');
    }
    return out;
  } finally {
    await fs.unlink(outPath).catch(() => {});
  }
}

module.exports = { inpaintImage, autoMask };
