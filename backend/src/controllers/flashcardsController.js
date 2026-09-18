'use strict';

const deckService = require('../services/flashcards/deckService');
const library = require('../services/flashcards/library');
const { exportDeck } = require('../services/flashcards/export');
const { mimeForExt } = require('../services/conversion/officeFormats');
const { sendSingleFile } = require('../utils/response');
const { persistSingle } = require('./helpers');
const { httpError } = require('../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Creador de flashcards (solo usuarios autenticados).
 *
 * - CRUD de mazos + activación/revocación del enlace público.
 * - Catálogo e ilustraciones de la biblioteca propia (rutas públicas).
 * - Exportación a PDF / PowerPoint (se guarda en el historial del usuario).
 * - Visor público por token: lectura + exportación SIN persistir nada.
 * ─────────────────────────────────────────────────────────────
 */

/** Extensión pedida en la ruta de exportación. */
function exportFormat(req) {
  const format = String(req.params.format || '').toLowerCase();
  if (format !== 'pdf' && format !== 'pptx') {
    throw httpError(400, 'Formato de exportación no soportado (usa pdf o pptx).');
  }
  return format;
}

/** Id numérico de la ruta. */
function deckId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, 'Mazo no encontrado.');
  return id;
}

// ── CRUD (privado) ───────────────────────────────────────────

/** GET /api/flashcards */
async function listDecks(req, res, next) {
  try {
    res.json({ decks: await deckService.listDecks(req.session.userId) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/flashcards/:id */
async function getDeck(req, res, next) {
  try {
    const { deck, cards } = await deckService.getDeck(req.session.userId, deckId(req));
    res.json({ deck: deckService.toDeck(deck, cards) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/flashcards */
async function createDeck(req, res, next) {
  try {
    const { deck, cards } = await deckService.createDeck(req.session.userId, req.body);
    res.status(201).json({ deck: deckService.toDeck(deck, cards) });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/flashcards/:id */
async function updateDeck(req, res, next) {
  try {
    const { deck, cards } = await deckService.updateDeck(req.session.userId, deckId(req), req.body);
    res.json({ deck: deckService.toDeck(deck, cards) });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/flashcards/:id */
async function deleteDeck(req, res, next) {
  try {
    await deckService.deleteDeck(req.session.userId, deckId(req));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── Compartir (privado) ──────────────────────────────────────

/** POST /api/flashcards/:id/share */
async function enableShare(req, res, next) {
  try {
    const { shareToken } = await deckService.setShare(req.session.userId, deckId(req), true);
    res.json({ shareToken, sharePath: `/flashcard?m=${shareToken}` });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/flashcards/:id/share */
async function disableShare(req, res, next) {
  try {
    await deckService.setShare(req.session.userId, deckId(req), false);
    res.json({ shareToken: null, sharePath: null });
  } catch (err) {
    next(err);
  }
}

// ── Exportación (privada, se guarda en el historial) ─────────

/** POST /api/flashcards/:id/export/:format */
async function exportDeckHandler(req, res, next) {
  try {
    const format = exportFormat(req);
    const userId = req.session.userId;
    const { deck, cards } = await deckService.getDeck(userId, deckId(req));

    const result = await exportDeck(deck, cards, format);
    const id = await persistSingle(
      userId,
      result.buffer,
      format === 'pdf' ? 'flashcards-to-pdf' : 'flashcards-to-pptx',
      deck.title,
      result.name
    );

    res.status(201).json({ id, name: result.name, format, size: result.buffer.length });
  } catch (err) {
    next(err);
  }
}

// ── Biblioteca (público) ─────────────────────────────────────

/** GET /api/flashcards/library */
async function getLibrary(req, res, next) {
  try {
    res.json({ categories: library.listCategories() });
  } catch (err) {
    next(err);
  }
}

/** GET /api/flashcards/library/:category/:file — sirve el SVG de la ilustración. */
async function getLibraryImage(req, res, next) {
  try {
    const file = String(req.params.file || '').replace(/\.svg$/i, '');
    const id = `${req.params.category}/${file}`;
    if (!library.isValidImageId(id)) throw httpError(404, 'Ilustración no encontrada.');

    const svg = await library.readImage(id);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.send(svg);
  } catch (err) {
    next(err);
  }
}

// ── Enlace compartido (público, sin persistencia) ────────────

/** GET /api/flashcards/share/:token */
async function getSharedDeck(req, res, next) {
  try {
    const { deck, cards } = await deckService.getDeckByToken(req.params.token);
    res.json({ deck: deckService.toPublicDeck(deck, cards) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/flashcards/share/:token/export/:format */
async function exportSharedDeck(req, res, next) {
  try {
    const format = exportFormat(req);
    const { deck, cards } = await deckService.getDeckByToken(req.params.token);
    const result = await exportDeck(deck, cards, format);
    sendSingleFile(res, result.buffer, result.name, mimeForExt(format));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDecks,
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  enableShare,
  disableShare,
  exportDeckHandler,
  getLibrary,
  getLibraryImage,
  getSharedDeck,
  exportSharedDeck
};
