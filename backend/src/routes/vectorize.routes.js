'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadFiles } = require('../middleware/upload');
const { vectorize } = require('../controllers/vectorizeController');

const router = Router();

// Vectorizar imágenes es una sección EXCLUSIVA para usuarios con sesión.
router.use(requireAuth);

// Sube una imagen y devuelve el SVG vectorial (color o blanco y negro).
router.post('/vectorize', uploadFiles('files', 1), vectorize);

module.exports = router;
