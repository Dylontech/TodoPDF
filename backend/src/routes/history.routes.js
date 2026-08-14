'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getHistory } = require('../controllers/historyController');

const router = Router();

// Historial de conversiones (solo usuarios autenticados).
router.get('/history', requireAuth, getHistory);

module.exports = router;
