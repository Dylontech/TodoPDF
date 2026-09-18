'use strict';

const pLimit = require('p-limit');

const config = require('../../config');
const { httpError } = require('../../utils/errors');
const { runSoffice } = require('../conversion/office');
const {
  buildDeckModel,
  MissingFontError,
  UnsupportedGlyphsError
} = require('./render');
const { buildDeckPdf } = require('./pdf');
const { buildDeckPptx } = require('./pptx');

/**
 * ─────────────────────────────────────────────────────────────
 * Orquestador de exportación de flashcards.
 *
 * PDF: se intenta primero la vía NATIVA (pdf-lib + fuente TTF embebida, todo
 * en RAM). Si no hay ninguna TTF válida en el sistema o la fuente no cubre
 * algún carácter del mazo (emoji, CJK…), se cae al camino de LibreOffice:
 * se genera el PPTX y se convierte a PDF con Impress (una tarjeta por página).
 *
 * PPTX: pptxgenjs directamente (sin LibreOffice).
 *
 * LibreOffice es pesado: todas las exportaciones pasan por un límite de
 * concurrencia (1 por defecto).
 * ─────────────────────────────────────────────────────────────
 */

const LIMIT = pLimit(config.flashcards.maxConcurrency);

/** Filtro de exportación de Impress → PDF. */
const IMPRESS_PDF_FILTER = 'pdf:impress_pdf_Export';

/**
 * Exporta un mazo.
 * @param {object} deck  Fila de `flashcard_decks`.
 * @param {Array}  cards Filas de `flashcards` ordenadas.
 * @param {'pdf'|'pptx'} format
 * @returns {Promise<{ buffer: Buffer, name: string, format: string }>}
 */
function exportDeck(deck, cards, format) {
  if (format !== 'pdf' && format !== 'pptx') {
    throw httpError(400, 'Formato de exportación no soportado (usa pdf o pptx).');
  }
  if (cards.length === 0) throw httpError(400, 'El mazo no tiene tarjetas que exportar.');

  return LIMIT(async () => {
    const model = await buildDeckModel(deck, cards);
    const name = exportName(deck.title, format);

    if (format === 'pptx') {
      return { buffer: await buildDeckPptx(model), name, format };
    }

    try {
      return { buffer: await buildDeckPdf(model), name, format };
    } catch (err) {
      if (!(err instanceof MissingFontError) && !(err instanceof UnsupportedGlyphsError)) throw err;

      // Respaldo: PowerPoint → PDF con LibreOffice (trae tipografías Noto).
      console.warn(`[flashcards] PDF nativo no disponible (${err.message}); se usa LibreOffice.`);
      const pptx = await buildDeckPptx(model);
      const pdf = await runSoffice({
        input: pptx,
        inputName: 'flashcards.pptx',
        infilter: null,
        convertTo: IMPRESS_PDF_FILTER,
        outputName: 'flashcards.pdf'
      });
      return { buffer: pdf, name: exportName(deck.title, 'pdf'), format };
    }
  });
}

/**
 * Nombre de archivo seguro a partir del título del mazo:
 * sin acentos, en minúsculas y con guiones.
 */
function exportName(title, format) {
  const slug = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `flashcards-${slug || 'mazo'}-${Date.now()}.${format}`;
}

module.exports = { exportDeck, exportName };
