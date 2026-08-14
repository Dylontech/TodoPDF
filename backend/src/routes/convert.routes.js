'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadFiles } = require('../middleware/upload');
const {
  convertPdfToImages,
  convertImagesToPdf,
  convertPdfToOffice,
  convertOfficeToPdf,
  download
} = require('../controllers/convertController');

const router = Router();

// PDF → imágenes (1 archivo). El middleware de subida elige la estrategia
// (RAM para invitados, disco temporal para autenticados) según la sesión.
router.post('/convert/pdf-to-images', uploadFiles('files', 1), convertPdfToImages);

// Imágenes → PDF (hasta 10 archivos).
router.post('/convert/images-to-pdf', uploadFiles('files', 10), convertImagesToPdf);

// PDF → Office (1 archivo + formato de salida: docx|doc|xlsx|pptx|odt).
router.post('/convert/pdf-to-office', uploadFiles('files', 1), convertPdfToOffice);

// Office → PDF (1 archivo; el formato de entrada se detecta por magic bytes).
router.post('/convert/office-to-pdf', uploadFiles('files', 1), convertOfficeToPdf);

// Descarga de una conversión guardada (solo el dueño).
router.get('/convert/:id/download', requireAuth, download);

module.exports = router;
