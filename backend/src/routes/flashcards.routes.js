'use strict';

const { Router } = require('express');

const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/flashcardsController');

/**
 * Mazos de flashcards (privado): CRUD, compartir y exportación.
 * Todas las rutas exigen sesión iniciada.
 */
const router = Router();

router.use(requireAuth);

router.get('/', controller.listDecks);
router.post('/', controller.createDeck);
router.get('/:id', controller.getDeck);
router.put('/:id', controller.updateDeck);
router.delete('/:id', controller.deleteDeck);
router.post('/:id/share', controller.enableShare);
router.delete('/:id/share', controller.disableShare);
router.post('/:id/export/:format', controller.exportDeckHandler);

module.exports = router;
