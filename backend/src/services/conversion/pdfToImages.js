'use strict';

const sharp = require('sharp');
const config = require('../../config');
const { detectFileType } = require('../../utils/files');
const { httpError } = require('../../utils/errors');
const { runCommand } = require('../../utils/exec');
const { countPages } = require('./pdfUtils');

/**
 * ─────────────────────────────────────────────────────────────
 * PDF → Imágenes con Ghostscript (PRIVACIDAD: todo en RAM)
 * ─────────────────────────────────────────────────────────────
 * El PDF se envía a Ghostscript por STDIN y las imágenes se
 * reciben por STDOUT. Ningún archivo toca el disco.
 *
 * Se renderiza página a página (con -dFirstPage/-dLastPage) para
 * obtener un Buffer independiente por página.
 *
 * @param {Buffer} pdfBuffer Contenido del PDF en memoria.
 * @param {object} [opts]    { format: 'jpeg'|'jpg'|'png'|'webp'|'tiff'|'bmp'|'gif', quality }
 * @returns {Promise<Buffer[]>} Un Buffer (imagen) por página.
 */
async function pdfToImages(pdfBuffer, opts = {}) {
  const format = (opts.format || 'jpeg').toLowerCase().replace('.', '');
  const quality = Math.min(100, Math.max(1, Number(opts.quality) || config.conversion.jpegQuality));

  // Validación por magic bytes: debe ser un PDF real
  const type = await detectFileType(pdfBuffer);
  if (!type || type.mime !== 'application/pdf') {
    throw httpError(400, 'El archivo debe ser un PDF válido.');
  }

  const pageCount = await countPages(pdfBuffer);
  if (pageCount > config.limits.maxPages) {
    throw httpError(400, `El PDF supera el límite de ${config.limits.maxPages} páginas.`);
  }

  // Formatos que Ghostscript genera directamente
  const gsDevice =
    format === 'png' ? 'png16m'
    : (format === 'jpeg' || format === 'jpg') ? 'jpeg'
    : null; // webp/tiff/bmp/gif → se renderiza PNG y se convierte con sharp

  const images = [];
  for (let page = 1; page <= pageCount; page++) {
    const raw = await renderPage(pdfBuffer, { page, device: gsDevice || 'png16m', quality });
    images.push(gsDevice ? raw : await convertImage(raw, format, quality));
  }
  return images;
}

/** Extensión de archivo correcta para un formato dado. */
function extensionFor(format) {
  const f = format.toLowerCase().replace('.', '');
  return f === 'jpeg' ? 'jpg' : f;
}

/** MIME del formato de imagen resultante. */
function mimeFor(format) {
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', tiff: 'image/tiff', bmp: 'image/bmp', gif: 'image/gif'
  };
  return map[format.toLowerCase().replace('.', '')] || 'application/octet-stream';
}

/**
 * Renderiza una página concreta del PDF a STDOUT y devuelve el Buffer.
 * Ghostscript recibe el PDF por STDIN (argumento `-`) y emite la imagen
 * por STDOUT (`-sOutputFile=-`): nada toca el disco.
 */
function renderPage(pdfBuffer, { page, device, quality }) {
  const args = [
    '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE',
    `-sDEVICE=${device}`,
    `-dJPEGQ=${quality}`,
    `-dFirstPage=${page}`,
    `-dLastPage=${page}`,
    '-sOutputFile=-', // salida por stdout → RAM
    '-'               // entrada por stdin → RAM
  ];
  return runCommand('gs', args, pdfBuffer).then((r) => r.stdout);
}

/**
 * Convierte un PNG (salida de Ghostscript) a otro formato con sharp
 * (para webp/tiff/bmp/gif, que Ghostscript no emite directamente).
 */
async function convertImage(buffer, format, quality) {
  const outOpts = {};
  if (format === 'webp') outOpts.webp = { quality };
  else if (format === 'tiff') outOpts.tiff = {};
  else if (format === 'bmp') outOpts.bmp = {};
  else if (format === 'gif') outOpts.gif = {};
  return sharp(buffer).toFormat(format, outOpts).toBuffer();
}

module.exports = { pdfToImages, extensionFor, mimeFor };
