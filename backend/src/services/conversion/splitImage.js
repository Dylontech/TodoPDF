'use strict';

const sharp = require('sharp');

const config = require('../../config');
const { httpError } = require('../../utils/errors');

const MAX_AXIS_CELLS = 20;
const MAX_PARTS = 100;
const MAX_INPUT_PIXELS = 80_000_000;

const SUPPORTED_FORMATS = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  gif: 'png',
  tif: 'tiff',
  tiff: 'tiff'
};

function parseAxis(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AXIS_CELLS) {
    throw httpError(400, `${label} debe ser un número entero entre 1 y ${MAX_AXIS_CELLS}.`);
  }
  return parsed;
}

function splitSizes(total, parts) {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function outputFormat(ext) {
  const format = SUPPORTED_FORMATS[ext];
  if (!format) {
    throw httpError(400, 'Formato de imagen no soportado. Usa PNG, JPG, WebP, GIF o TIFF.');
  }
  return { format, ext: ext === 'gif' ? 'png' : ext === 'jpeg' ? 'jpg' : ext };
}

/** Aplica el codificador final sobre una tubería de sharp ya preparada (una sola pasada). */
async function encodePart(pipeline, format) {
  const quality = config.conversion.jpegQuality;
  if (format === 'jpeg') return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  if (format === 'webp') return pipeline.webp({ quality }).toBuffer();
  if (format === 'tiff') return pipeline.tiff({ compression: 'lzw' }).toBuffer();
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Divide una imagen normalizada en una cuadrícula fila-major.
 * Los restos de la división se reparten entre las primeras filas/columnas.
 */
async function splitImage(inputBuffer, { columns, rows, inputExt }) {
  const columnCount = parseAxis(columns, 'Las columnas');
  const rowCount = parseAxis(rows, 'Las filas');
  if (columnCount * rowCount > MAX_PARTS) {
    throw httpError(400, `La cuadrícula no puede superar ${MAX_PARTS} piezas.`);
  }

  const format = outputFormat(inputExt);

  // 1) Dimensiones del ORIGINAL: metadata() no decodifica la imagen, así el tope
  //    de píxeles se valida antes de gastar memoria normalizando.
  let sourceMeta;
  try {
    sourceMeta = await sharp(inputBuffer).metadata();
  } catch {
    throw httpError(400, 'La imagen no se puede leer o está dañada.');
  }
  const sourceWidth = sourceMeta.width || 0;
  const sourceHeight = sourceMeta.height || 0;
  if (!sourceWidth || !sourceHeight) throw httpError(400, 'La imagen no tiene dimensiones válidas.');
  if (sourceWidth * sourceHeight > MAX_INPUT_PIXELS) {
    throw httpError(400, 'La imagen es demasiado grande para subdividirla.');
  }

  // 2) Normalización EXIF: el corte opera sobre la imagen ya orientada.
  let normalized;
  try {
    normalized = await sharp(inputBuffer).rotate().toBuffer();
  } catch {
    throw httpError(400, 'La imagen no se puede leer o está dañada.');
  }

  let metadata;
  try {
    metadata = await sharp(normalized).metadata();
  } catch {
    throw httpError(400, 'No se pudieron leer las dimensiones de la imagen.');
  }
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) throw httpError(400, 'La imagen no tiene dimensiones válidas.');
  // Sin esto una cuadrícula con más celdas que píxeles generaría trozos de 0 px.
  if (columnCount > width || rowCount > height) {
    throw httpError(400, 'Hay más cortes que píxeles en la imagen: reduce las filas o las columnas.');
  }

  const columnWidths = splitSizes(width, columnCount);
  const rowHeights = splitSizes(height, rowCount);
  const parts = [];
  let top = 0;

  for (let row = 0; row < rowCount; row++) {
    let left = 0;
    for (let column = 0; column < columnCount; column++) {
      const partWidth = columnWidths[column];
      const partHeight = rowHeights[row];
      // Recorte y codificación final en la MISMA tubería: una sola pasada por trozo.
      const buffer = await encodePart(
        sharp(normalized).extract({ left, top, width: partWidth, height: partHeight }),
        format.format
      );
      parts.push({ buffer, row: row + 1, column: column + 1 });
      left += partWidth;
    }
    top += rowHeights[row];
  }

  return { parts, width, height, ext: format.ext };
}

module.exports = {
  splitImage,
  MAX_AXIS_CELLS,
  MAX_PARTS
};
