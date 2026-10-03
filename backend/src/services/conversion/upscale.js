'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const config = require('../../config');
const { runCommand } = require('../../utils/exec');
const { httpError } = require('../../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Reescalar imagen (x2/x4 con sharp, x8/x16 con Real-ESRGAN IA).
 *
 * x2/x4: interpolación lanczos3 pura con sharp — instantánea y sin
 *        dependencias externas (disponible también para invitados).
 * x8/x16: UNA pasada de superresolución ×4 con Real-ESRGAN (script Python,
 *        imagen por stdin → PNG temporal) y el factor restante (×2/×4) se
 *        completa con lanczos3. Regenera detalle, pero es lenta en CPU.
 * ─────────────────────────────────────────────────────────────
 */

const SCRIPT = config.upscale.scriptPath;

// Formatos de ENTRADA que sharp puede decodificar (ext de file-type → sharp).
// Nota: GIF animado → solo el primer fotograma; BMP/HEIC no soportados.
const SUPPORTED_INPUT = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  tif: 'tiff',
  tiff: 'tiff'
};

// Formatos de SALIDA ofrecidos en la página (selector de formato).
const OUTPUT_FORMATS = {
  png: { ext: 'png', mime: 'image/png' },
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  webp: { ext: 'webp', mime: 'image/webp' }
};

/** MIME del formato de salida (para la respuesta directa a invitados). */
function mimeFor(format) {
  const f = OUTPUT_FORMATS[format];
  return f ? f.mime : 'application/octet-stream';
}

/** Extensión de archivo del formato de salida. */
function extFor(format) {
  const f = OUTPUT_FORMATS[format];
  return f ? f.ext : 'png';
}

/** Codifica el buffer al formato de salida pedido (PNG sin pérdida). */
async function encode(buffer, format, quality) {
  let pipeline = sharp(buffer);
  if (format === 'jpg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }
  return pipeline.toBuffer();
}

/**
 * Reescala una imagen.
 *
 * @param {Buffer} inputBuffer Imagen original (PNG/JPG/WebP/GIF/TIFF).
 * @param {object} opts { scale, format, quality } — scale ∈ {2,4,8,16}.
 * @returns {Promise<Buffer>} Imagen reescalada en el formato pedido.
 */
async function upscaleImage(inputBuffer, opts = {}) {
  const scale = opts.scale;
  const format = opts.format || 'png';
  const quality = opts.quality || config.conversion.jpegQuality;

  const meta = await sharp(inputBuffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) {
    throw httpError(400, 'No se pudo leer la imagen (dimensiones desconocidas).');
  }

  // ── x2/x4: interpolación lanczos3 pura con sharp (rápido, sin IA) ──
  if (scale <= 4) {
    const resized = await sharp(inputBuffer)
      .resize({ width: width * scale, height: height * scale, kernel: 'lanczos3' })
      .toBuffer();
    return encode(resized, format, quality);
  }

  // ── x8/x16: pasada IA ×4 (Real-ESRGAN) + lanczos3 del factor restante ──
  const dir = path.join(config.storage.tempDir, 'upscale');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `out-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);

  try {
    await runCommand(
      config.upscale.pythonPath,
      [SCRIPT, outPath, config.upscale.modelPath],
      inputBuffer,
      { timeoutMs: config.upscale.timeoutMs }
    );

    const aiPng = await fs.readFile(outPath);
    if (!aiPng || aiPng.length === 0) {
      throw httpError(500, 'El reescalado con IA no devolvió ningún resultado.');
    }

    // La IA entrega ×4; se completa hasta la escala pedida con lanczos3
    // (el tamaño objetivo ya es width*scale × height*scale).
    const resized = await sharp(aiPng)
      .resize({ width: width * scale, height: height * scale, kernel: 'lanczos3' })
      .toBuffer();
    return encode(resized, format, quality);
  } finally {
    // El archivo temporal se borra SIEMPRE, incluso si falla el procesado.
    await fs.unlink(outPath).catch(() => {});
  }
}

module.exports = {
  upscaleImage,
  SUPPORTED_INPUT,
  OUTPUT_FORMATS,
  mimeFor,
  extFor
};
