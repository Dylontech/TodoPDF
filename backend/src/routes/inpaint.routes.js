'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadFiles, uploadFields } = require('../middleware/upload');
const { inpaint, autoMask } = require('../controllers/inpaintController');

const router = Router();

// Quitar objetos de imagen es una sección EXCLUSIVA para usuarios con sesión.
router.use(requireAuth);

// Máscara automática por clic: sube la imagen + coords (x, y) en el body y
// devuelve la máscara como PNG para previsualizarla.
router.post('/inpaint/auto-mask', uploadFiles('files', 1), autoMask);

// Borra los objetos de la imagen marcados en la máscara.
// Multipart: campo `files` (imagen) + campo `mask` (PNG de máscara).
router.post(
  '/inpaint',
  uploadFields([
    { name: 'files', maxCount: 1 },
    { name: 'mask', maxCount: 1 }
  ]),
  inpaint
);

module.exports = router;
