'use strict';

const fs = require('node:fs');
const sharp = require('sharp');

const config = require('../../config');
const { httpError } = require('../../utils/errors');
const library = require('./library');

/**
 * ─────────────────────────────────────────────────────────────
 * Maquetación compartida de las flashcards.
 *
 * Tanto el PDF (pdf-lib) como el PPTX (pptxgenjs) usan las MISMAS medidas
 * (página A6 vertical, 105 × 148 mm) y los mismos tamaños de texto, de modo
 * que el PDF generado por LibreOffice en el camino de respaldo se ve igual
 * que el PDF nativo.
 *
 * Unidades: puntos PostScript (1 pt = 1/72 in). pptxgenjs trabaja en pulgadas,
 * así que las constantes `IN_*` son la conversión para PowerPoint.
 * ─────────────────────────────────────────────────────────────
 */

const PT_PER_IN = 72;

/** Página = una tarjeta A6 vertical. */
const CARD = {
  width: 297.64, // 105 mm
  height: 419.53, // 148 mm
  margin: 26
};
CARD.widthIn = CARD.width / PT_PER_IN;
CARD.heightIn = CARD.height / PT_PER_IN;
CARD.marginIn = CARD.margin / PT_PER_IN;

/** Colores (hex sin almohadilla para pptxgenjs; objeto `rgb` para pdf-lib). */
const COLORS = {
  ink: '1e293b',
  muted: '64748b',
  accent: 'f97316',
  line: 'e2e8f0',
  white: 'ffffff'
};

const SIZES = {
  coverTitle: 24,
  coverMeta: 11,
  term: 20,
  definition: 12,
  footer: 8
};

/** Máximo alto de la ilustración dentro de la tarjeta (en puntos). */
const IMAGE_MAX_HEIGHT = 150;

/** Marca de error de cobertura de fuente (dispara el respaldo con LibreOffice). */
class UnsupportedGlyphsError extends Error {
  constructor(missing, fontPath) {
    super(`La fuente ${fontPath} no cubre: ${missing}`);
    this.name = 'UnsupportedGlyphsError';
    this.missing = missing;
  }
}

/** Marca de "no hay ninguna fuente TTF utilizable" (idem). */
class MissingFontError extends Error {
  constructor(tried) {
    super(`No se encontró ninguna fuente TTF (probadas: ${tried.join(', ')})`);
    this.name = 'MissingFontError';
  }
}

/** Normaliza un texto del usuario para imprimirlo. */
function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Divide un texto en líneas que caben en `maxWidth`.
 * `widthOf` es una función (line, size) → ancho en puntos (la fuente del PDF).
 */
function wrapText(text, widthOf, size, maxWidth) {
  const lines = [];
  for (const paragraph of normalizeText(text).split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (widthOf(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  // Recorta líneas vacías de los extremos
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Localiza el primer archivo existente de una lista de candidatos. */
function firstExisting(paths, explicit) {
  const candidates = [explicit, ...paths].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

let fontCache = null;

/**
 * Fuentes TTF para el PDF nativo. Si no hay ninguna disponible se lanza
 * MissingFontError → el exportador usa el camino de LibreOffice.
 */
function resolveFonts() {
  if (fontCache) return fontCache;

  const F = config.flashcards;
  const regularPath = firstExisting(F.fontCandidates, F.fontPath);
  if (!regularPath) throw new MissingFontError([F.fontPath, ...F.fontCandidates].filter(Boolean));

  const boldPath = firstExisting(F.fontBoldCandidates, F.fontBoldPath) || regularPath;
  fontCache = {
    regular: fs.readFileSync(regularPath),
    bold: fs.readFileSync(boldPath),
    regularPath,
    boldPath
  };
  return fontCache;
}

/**
 * Rasteriza una ilustración de la biblioteca a PNG (para PDF y PPTX,
 * que no pueden incrustar SVG de forma fiable).
 */
async function rasterizeImage(imageId) {
  const svg = await library.readImage(imageId);
  try {
    return await sharp(svg)
      .resize({ height: config.flashcards.imageHeight, fit: 'inside' })
      .png()
      .toBuffer();
  } catch {
    throw httpError(500, `No se pudo preparar la imagen "${imageId}" para la exportación.`);
  }
}

/** Modelo de un mazo listo para maquetar (imágenes ya en PNG). */
async function buildDeckModel(deck, cards) {
  const images = new Map();
  for (const card of cards) {
    if (card.image && !images.has(card.image)) {
      images.set(card.image, await rasterizeImage(card.image));
    }
  }

  return {
    title: normalizeText(deck.title),
    description: normalizeText(deck.description || ''),
    cards: cards.map((card) => ({
      term: normalizeText(card.term),
      definition: normalizeText(card.definition),
      image: card.image ? images.get(card.image) : null,
      imageId: card.image || null
    }))
  };
}

/** Todo el texto de un mazo (para comprobar la cobertura de la fuente). */
function deckText(deckModel) {
  const parts = [deckModel.title, deckModel.description];
  for (const card of deckModel.cards) {
    parts.push(card.term, card.definition);
  }
  return parts.join('\n');
}

module.exports = {
  PT_PER_IN,
  CARD,
  COLORS,
  SIZES,
  IMAGE_MAX_HEIGHT,
  UnsupportedGlyphsError,
  MissingFontError,
  normalizeText,
  wrapText,
  resolveFonts,
  rasterizeImage,
  buildDeckModel,
  deckText
};
