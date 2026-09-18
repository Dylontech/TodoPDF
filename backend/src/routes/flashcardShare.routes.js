'use strict';

const { Router } = require('express');

const controller = require('../controllers/flashcardsController');

/**
 * Enlace compartido de un mazo (PÚBLICO, sin sesión).
 *
 * Solo expone el título, la descripción y las tarjetas: nunca datos del dueño.
 * La exportación desde un enlace público se sirve en RAM y NO se registra en
 * ningún historial.
 */
const router = Router();

/** Mazo compartido por token. */
router.get('/:token', controller.getSharedDeck);

/** Exportación directa (pdf|pptx) del mazo compartido. */
router.get('/:token/export/:format', controller.exportSharedDeck);

module.exports = router;
