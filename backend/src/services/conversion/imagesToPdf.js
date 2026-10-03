'use strict';

const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { detectFileType } = require('../../utils/files');
const { httpError } = require('../../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Imágenes → PDF único (sharp + pdf-lib, todo en RAM)
 * ─────────────────────────────────────────────────────────────
 * Normaliza la orientación EXIF con sharp (fotos de móvil) y
 * embebe cada imagen en una página del PDF con pdf-lib.
 *
 * IMPORTANTE: `detectFileType` reconoce MÁS formatos de los que sharp
 * (libvips) puede DECODIFICAR en esta instalación. Si se deja pasar uno no
 * soportado, sharp lanza y el cliente recibe un 500 opaco (en producción,
 * "Error interno del servidor"). De ahí la lista blanca y el 400 explicativo.
 *
 * Verificado con sharp 0.33.5 / libvips 8.15.3:
 *   - Sí: JPEG, PNG, WebP, GIF, TIFF.
 *   - No: BMP (libvips no lo lee) ni HEIC de iPhone (el `heif` de libvips no
 *     trae decoder HEVC, sólo AVIF).
 *
 * @param {Buffer[]} imageBuffers Imágenes a combinar (ya en memoria).
 * @returns {Promise<Buffer>} PDF resultante.
 */

/** Formatos que el binario de sharp puede decodificar. MIME → etiqueta. */
const FORMATOS_ADMITIDOS = new Map([
  ['image/jpeg', 'JPG'],
  ['image/png', 'PNG'],
  ['image/webp', 'WebP'],
  ['image/gif', 'GIF'],
  ['image/tiff', 'TIFF']
]);

/** Lista legible de formatos, para los mensajes de error. */
const LISTA_FORMATOS = Array.from(FORMATOS_ADMITIDOS.values()).join(', ');

async function imagesToPdf(imageBuffers) {
  if (!imageBuffers || imageBuffers.length === 0) {
    throw httpError(400, 'No se recibió ninguna imagen.');
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle('Documento convertido con TodoPDF');

  for (const raw of imageBuffers) {
    // Validación por magic bytes: debe ser una imagen real
    const type = await detectFileType(raw);
    if (!type || !type.mime.startsWith('image/')) {
      throw httpError(400, `Uno de los archivos no es una imagen válida (${type ? type.mime : 'desconocido'}).`);
    }

    // El MIME real debe estar entre los que sharp sabe decodificar aquí.
    // Si no, se responde 400 con el motivo (antes: 500 opaco de sharp).
    const etiqueta = FORMATOS_ADMITIDOS.get(type.mime);
    if (!etiqueta) {
      const detectado = (type.ext || type.mime).toUpperCase();
      throw httpError(
        400,
        `Formato de imagen no soportado (${detectado}). Formatos admitidos: ${LISTA_FORMATOS}. ` +
          'Convierte la imagen a JPG o PNG antes de subirla.'
      );
    }

    // Normaliza orientación EXIF y obtiene dimensiones finales
    let oriented;
    try {
      oriented = await sharp(raw).rotate().toBuffer();
    } catch (err) {
      // Imagen corrupta o variante no decodificable pese al formato admitido
      console.error(`[TodoPDF] Imagen ${etiqueta} no decodificable:`, err.message);
      throw httpError(400, `No se pudo leer una de las imágenes (${etiqueta}); puede estar dañada.`);
    }
    const meta = await sharp(oriented).metadata();

    let embedded;
    if (meta.format === 'jpeg') {
      embedded = await pdf.embedJpg(oriented);
    } else if (meta.format === 'png') {
      embedded = await pdf.embedPng(oriented);
    } else {
      // webp/gif/tiff → PNG intermedio embebible
      const png = await sharp(oriented).png().toBuffer();
      const m = await sharp(png).metadata();
      meta.width = m.width;
      meta.height = m.height;
      embedded = await pdf.embedPng(png);
    }

    // Una página por imagen, con el mismo tamaño (en puntos)
    const page = pdf.addPage([meta.width, meta.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: meta.width, height: meta.height });
  }

  return Buffer.from(await pdf.save());
}

module.exports = { imagesToPdf };
