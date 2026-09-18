'use strict';

const crypto = require('node:crypto');

const db = require('../../config/db');
const config = require('../../config');
const { httpError } = require('../../utils/errors');
const library = require('./library');

/**
 * ─────────────────────────────────────────────────────────────
 * Mazos de flashcards: acceso a datos y validación.
 *
 * Toda operación privada filtra SIEMPRE por `user_id` (un mazo ajeno se
 * comporta como inexistente → 404, sin filtrar información).
 * ─────────────────────────────────────────────────────────────
 */

const F = config.flashcards;

/** Texto obligatorio normalizado con tope de longitud. */
function requiredText(value, { label, max }) {
  const text = String(value ?? '').trim();
  if (!text) throw httpError(400, `Falta ${label}.`);
  if (text.length > max) {
    throw httpError(400, `${label.charAt(0).toUpperCase()}${label.slice(1)} no puede superar ${max} caracteres.`);
  }
  return text;
}

/** Valida y normaliza una tarjeta del payload. */
function normalizeCard(raw) {
  const card = raw && typeof raw === 'object' ? raw : {};
  const term = requiredText(card.term, { label: 'el término', max: F.maxTermLen });
  const definition = requiredText(card.definition, { label: 'la definición', max: F.maxDefinitionLen });

  // Imagen opcional: debe existir en la biblioteca (whitelist del manifest).
  let image = card.image === undefined || card.image === null ? '' : String(card.image).trim();
  if (image && !library.isValidImageId(image)) {
    throw httpError(400, `La imagen "${image}" no existe en la biblioteca.`);
  }

  return { term, definition, image: image || null };
}

/** Valida y normaliza el payload completo de un mazo. */
function normalizeDeckPayload(body) {
  const source = body && typeof body === 'object' ? body : {};
  const title = requiredText(source.title, { label: 'el título', max: F.maxTitleLen });

  const description = String(source.description ?? '').trim();
  if (description.length > F.maxDescriptionLen) {
    throw httpError(400, `La descripción no puede superar ${F.maxDescriptionLen} caracteres.`);
  }

  const rawCards = Array.isArray(source.cards) ? source.cards : [];
  if (rawCards.length === 0) throw httpError(400, 'Añade al menos una tarjeta al mazo.');
  if (rawCards.length > F.maxCards) {
    throw httpError(400, `Un mazo no puede tener más de ${F.maxCards} tarjetas.`);
  }

  return {
    title,
    description: description || null,
    cards: rawCards.map(normalizeCard)
  };
}

/** Resumen de un mazo (sin sus tarjetas). */
function toSummary(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    cardCount: Number(row.cardCount || 0),
    shareToken: row.share_token || null,
    updatedAt: row.updated_at
  };
}

/** Mazo completo (privado, para el editor). */
function toDeck(deck, cards) {
  return {
    id: deck.id,
    title: deck.title,
    description: deck.description || '',
    shareToken: deck.share_token || null,
    updatedAt: deck.updated_at,
    cards: cards.map((c) => ({
      id: c.id,
      term: c.term,
      definition: c.definition,
      image: c.image || null
    }))
  };
}

/** Mazo público (enlace compartido): sin datos del dueño ni ids internos. */
function toPublicDeck(deck, cards) {
  return {
    title: deck.title,
    description: deck.description || '',
    cards: cards.map((c) => ({
      term: c.term,
      definition: c.definition,
      image: c.image || null,
      imageUrl: c.image ? library.imageUrl(c.image) : null
    }))
  };
}

/** Lista de mazos del usuario con el nº de tarjetas. */
async function listDecks(userId) {
  const rows = await db('flashcard_decks as d')
    .leftJoin('flashcards as c', 'c.deck_id', 'd.id')
    .where('d.user_id', userId)
    .groupBy('d.id', 'd.title', 'd.description', 'd.share_token', 'd.created_at', 'd.updated_at')
    .orderBy('d.updated_at', 'desc')
    .select('d.id', 'd.title', 'd.description', 'd.share_token', 'd.created_at', 'd.updated_at')
    .count({ cardCount: 'c.id' });

  return rows.map(toSummary);
}

/** Mazo propio con sus tarjetas (404 si no existe o es de otro usuario). */
async function getDeck(userId, deckId) {
  const deck = await db('flashcard_decks').where({ id: deckId, user_id: userId }).first();
  if (!deck) throw httpError(404, 'Mazo no encontrado.');

  const cards = await db('flashcards')
    .where({ deck_id: deck.id })
    .orderBy('position', 'asc')
    .select('id', 'term', 'definition', 'image');

  return { deck, cards };
}

/** Crea un mazo con sus tarjetas (transacción). */
async function createDeck(userId, body) {
  const { title, description, cards } = normalizeDeckPayload(body);

  const deckId = await db.transaction(async (trx) => {
    const [id] = await trx('flashcard_decks').insert({
      user_id: userId,
      title,
      description
    });
    await trx('flashcards').insert(
      cards.map((card, index) => ({ deck_id: id, position: index, ...card }))
    );
    return id;
  });

  return getDeck(userId, deckId);
}

/** Reemplaza el contenido de un mazo propio (transacción). */
async function updateDeck(userId, deckId, body) {
  const { title, description, cards } = normalizeDeckPayload(body);
  const deck = await db('flashcard_decks').where({ id: deckId, user_id: userId }).first();
  if (!deck) throw httpError(404, 'Mazo no encontrado.');

  await db.transaction(async (trx) => {
    await trx('flashcard_decks')
      .where({ id: deck.id })
      .update({ title, description, updated_at: trx.fn.now() });
    // Reemplazo completo: el editor siempre envía el mazo entero ordenado.
    await trx('flashcards').where({ deck_id: deck.id }).del();
    await trx('flashcards').insert(
      cards.map((card, index) => ({ deck_id: deck.id, position: index, ...card }))
    );
  });

  return getDeck(userId, deckId);
}

/** Elimina un mazo propio (las tarjetas caen por ON DELETE CASCADE). */
async function deleteDeck(userId, deckId) {
  const deleted = await db('flashcard_decks').where({ id: deckId, user_id: userId }).del();
  if (!deleted) throw httpError(404, 'Mazo no encontrado.');
}

/** Genera un token público único (base64url, 22 caracteres). */
async function generateToken() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = crypto.randomBytes(16).toString('base64url');
    const existing = await db('flashcard_decks').where({ share_token: token }).first('id');
    if (!existing) return token;
  }
  throw httpError(500, 'No se pudo generar el enlace para compartir. Inténtalo de nuevo.');
}

/**
 * Activa o revoca el enlace público de un mazo propio.
 * Activar es idempotente: conserva el token existente.
 */
async function setShare(userId, deckId, enabled) {
  const deck = await db('flashcard_decks').where({ id: deckId, user_id: userId }).first();
  if (!deck) throw httpError(404, 'Mazo no encontrado.');

  if (!enabled) {
    if (deck.share_token) {
      await db('flashcard_decks').where({ id: deck.id }).update({ share_token: null });
    }
    return { shareToken: null };
  }

  const token = deck.share_token || (await generateToken());
  if (!deck.share_token) {
    await db('flashcard_decks').where({ id: deck.id }).update({ share_token: token });
  }
  return { shareToken: token };
}

/** Mazo compartido por token (público, sin datos del dueño). */
async function getDeckByToken(token) {
  const clean = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{10,32}$/.test(clean)) throw httpError(404, 'Enlace no válido.');

  const deck = await db('flashcard_decks').where({ share_token: clean }).first();
  if (!deck) throw httpError(404, 'Este enlace de flashcards no existe o fue revocado.');

  const cards = await db('flashcards')
    .where({ deck_id: deck.id })
    .orderBy('position', 'asc')
    .select('term', 'definition', 'image');

  return { deck, cards };
}

module.exports = {
  listDecks,
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  setShare,
  getDeckByToken,
  toDeck,
  toPublicDeck,
  normalizeDeckPayload
};
