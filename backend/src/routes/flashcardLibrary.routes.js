'use strict';

const { Router } = require('express');

const controller = require('../controllers/flashcardsController');

/**
 * Biblioteca de ilustraciones de flashcards (PÚBLICA, sin sesión).
 *
 * Se monta ANTES del router privado de flashcards: los routers con
 * `requireAuth` responden 401 a todo su prefijo, así que las rutas públicas
 * deben declararse primero (mismo motivo por el que /api/health se movió
 * antes de los routers protegidos en app.js).
 */
const router = Router();

/** Catálogo completo de categorías e ilustraciones. */
router.get('/', controller.getLibrary);

/** SVG de una ilustración (cacheable: son assets estáticos de la app). */
router.get('/:category/:file', controller.getLibraryImage);

module.exports = router;
