'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadFiles } = require('../middleware/upload');
const { removeBg } = require('../controllers/removeBgController');

const router = Router();

// Quitar fondo es una sección EXCLUSIVA para usuarios con sesión.
router.use(requireAuth);

// Sube una imagen y devuelve el PNG con el fondo eliminado.
router.post('/remove-bg', uploadFiles('files', 1), removeBg);

module.exports = router;
