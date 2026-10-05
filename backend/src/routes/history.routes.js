'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getHistory, deleteConversion, deleteAllHistory } = require('../controllers/historyController');

const router = Router();

// Historial de conversiones (solo usuarios autenticados).
router.get('/history', requireAuth, getHistory);
router.delete('/history', requireAuth, deleteAllHistory);
router.delete('/history/conversions/:id', requireAuth, deleteConversion);

module.exports = router;
