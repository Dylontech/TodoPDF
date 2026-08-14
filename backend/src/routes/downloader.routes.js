'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getInfo,
  download,
  getHistory,
  downloadFile
} = require('../controllers/downloaderController');

const router = Router();

// El descargador es una sección EXCLUSIVA para usuarios con sesión.
router.use(requireAuth);

// Metadata del vídeo (sin descargar)
router.post('/downloader/info', getInfo);

// Descarga y guarda el vídeo/audio en el almacenamiento del usuario
router.post('/downloader/download', download);

// Historial de descargas del usuario
router.get('/downloader/history', getHistory);

// Descarga del archivo guardado (solo el dueño)
router.get('/downloader/:id/download', downloadFile);

module.exports = router;
