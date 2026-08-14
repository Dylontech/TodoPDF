'use strict';

const { Router } = require('express');
const { uploadFiles, uploadFields } = require('../middleware/upload');
const {
  pdfInfo,
  pdfSplit,
  pdfExtract,
  pdfMerge,
  pdfInsert,
  pdfRotate,
  pdfDelete,
  pdfOrganize,
  pdfCompress
} = require('../controllers/pdfToolsController');

const router = Router();

// Información de un PDF (nº de páginas) para las UI de organizar/insertar.
router.post('/convert/pdf-info', uploadFiles('files', 1), pdfInfo);

// Dividir PDF (1 archivo + modo: ranges|every|pages|size).
router.post('/convert/pdf-split', uploadFiles('files', 1), pdfSplit);

// Extraer páginas (1 archivo + lista de páginas).
router.post('/convert/pdf-extract', uploadFiles('files', 1), pdfExtract);

// Fusionar PDFs (2-10 archivos).
router.post('/convert/pdf-merge', uploadFiles('files', 10), pdfMerge);

// Insertar páginas (base en `files` + PDF a insertar en `insert` + posición).
router.post(
  '/convert/pdf-insert',
  uploadFields([
    { name: 'files', maxCount: 1 },
    { name: 'insert', maxCount: 1 }
  ]),
  pdfInsert
);

// Rotar páginas (1 archivo + grados + páginas opcionales).
router.post('/convert/pdf-rotate', uploadFiles('files', 1), pdfRotate);

// Eliminar páginas (1 archivo + lista de páginas).
router.post('/convert/pdf-delete', uploadFiles('files', 1), pdfDelete);

// Organizar páginas (1 archivo + nuevo orden).
router.post('/convert/pdf-organize', uploadFiles('files', 1), pdfOrganize);

// Comprimir PDF (1 archivo + perfil screen|ebook|printer).
router.post('/convert/pdf-compress', uploadFiles('files', 1), pdfCompress);

module.exports = router;
