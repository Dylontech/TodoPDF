'use strict';

const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const config = require('../config');

/**
 * Estrategias de subida según el flujo:
 *
 *  - memoryStorage  → el archivo queda SOLO en RAM (flujo INVITADO).
 *  - diskStorage    → el archivo se escribe en un temporal (flujo AUTENTICADO);
 *                     el temporal se borra tras procesar y el resultado final
 *                     se guarda en el volumen /data/storage.
 */

// Flujo invitado: 100% memoria, nunca toca disco.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.maxUploadGuest, files: 10 }
});

// Flujo autenticado: staging en disco temporal.
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(config.storage.tempDir, { recursive: true });
    cb(null, config.storage.tempDir);
  },
  filename: (req, file, cb) => {
    // Nombre único y sanitizado (evita colisiones y path traversal)
    const ext = path
      .extname(file.originalname || '')
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const diskUpload = multer({
  storage: diskStorage,
  limits: { fileSize: config.limits.maxUploadAuth, files: 10 }
});

/**
 * Selecciona la estrategia de subida según la sesión del request:
 *  - con userId → diskUpload (temporal en disco)
 *  - invitado   → memoryUpload (solo RAM)
 *
 * @param {string} field Campo multipart donde están los archivos.
 * @param {number} maxFiles Máximo de archivos permitidos.
 */
function uploadFiles(field = 'files', maxFiles = 10) {
  return (req, res, next) => {
    const middleware = req.session && req.session.userId
      ? diskUpload.array(field, maxFiles)
      : memoryUpload.array(field, maxFiles);
    middleware(req, res, next);
  };
}

/**
 * Subida con varios campos multipart con nombre (p. ej. Insertar páginas:
 * campos `files` + `insert`). Elige la estrategia según la sesión, igual
 * que uploadFiles.
 *
 * @param {Array<{ name: string, maxCount: number }>} specs
 */
function uploadFields(specs) {
  return (req, res, next) => {
    const middleware = req.session && req.session.userId
      ? diskUpload.fields(specs)
      : memoryUpload.fields(specs);
    middleware(req, res, next);
  };
}

module.exports = { memoryUpload, diskUpload, uploadFiles, uploadFields };
