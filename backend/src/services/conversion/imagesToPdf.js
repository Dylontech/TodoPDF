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
 * @param {Buffer[]} imageBuffers Imágenes a combinar (ya en memoria).
 * @returns {Promise<Buffer>} PDF resultante.
 */
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

    // Normaliza orientación EXIF y obtiene dimensiones finales
    const oriented = await sharp(raw).rotate().toBuffer();
    const meta = await sharp(oriented).metadata();

    let embedded;
    if (meta.format === 'jpeg') {
      embedded = await pdf.embedJpg(oriented);
    } else if (meta.format === 'png') {
      embedded = await pdf.embedPng(oriented);
    } else {
      // webp/gif/tiff/bmp → PNG intermedio embebible
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
