'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../../config');
const { runCommand } = require('../../utils/exec');
const { httpError } = require('../../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Quitar fondo de imagen con IA (rembg/u2net).
 *
 * Igual que Ghostscript/LibreOffice, se invoca un binario externo por pipes:
 * la imagen original entra por stdin y el script Python escribe el PNG
 * (fondo transparente) en un archivo temporal que luego se lee a RAM.
 * El modelo ONNX se cachea en disco (U2NET_HOME) entre invocaciones.
 * ─────────────────────────────────────────────────────────────
 */

const SCRIPT = config.removeBg.scriptPath;

/**
 * @param {Buffer} inputBuffer Imagen original (PNG/JPG/WebP, ...).
 * @param {object} [opts] Opciones { model }.
 * @returns {Promise<Buffer>} PNG con fondo transparente.
 */
async function removeBackground(inputBuffer, opts = {}) {
  const model = opts.model || config.removeBg.model;

  const dir = path.join(config.storage.tempDir, 'removebg');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `out-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);

  try {
    await runCommand(
      config.removeBg.pythonPath,
      [SCRIPT, outPath, model],
      inputBuffer,
      { timeoutMs: config.removeBg.timeoutMs }
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

module.exports = { removeBackground };
