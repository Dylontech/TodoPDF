'use strict';

const fs = require('node:fs/promises');

const db = require('../config/db');
const storage = require('../services/storageService');
const { httpError } = require('../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Helpers compartidos por los controladores de conversión/herramientas.
 * Gestión de archivos de multer (RAM invitado / disco autenticado) y
 * persistencia del resultado en el flujo autenticado (disco + historial DB).
 * ─────────────────────────────────────────────────────────────
 */

/** Devuelve los archivos de un campo (funciona con array u objeto de multer). */
function filesOf(req, field) {
  const files = req.files;
  if (!files) return [];
  return Array.isArray(files) ? files : files[field] || [];
}

/** Buffer del primer archivo de un campo. */
async function getInputBuffer(req, field = 'files') {
  const files = filesOf(req, field);
  if (files.length === 0) throw httpError(400, 'No se recibió ningún archivo.');
  const file = files[0];
  return file.path ? fs.readFile(file.path) : file.buffer;
}

/** Buffers de todos los archivos de un campo (mantiene el orden). */
async function getInputBuffers(req, field = 'files') {
  const files = filesOf(req, field);
  if (files.length === 0) throw httpError(400, 'No se recibió ningún archivo.');
  return Promise.all(files.map((f) => (f.path ? fs.readFile(f.path) : f.buffer)));
}

/** Nombre original del primer archivo de un campo. */
function originalName(req, field = 'files') {
  const files = filesOf(req, field);
  return files.length > 0 ? files[0].originalname : 'documento';
}

/** Limpia los temporales de subida (flujo autenticado). */
async function cleanupUploads(req) {
  const files = Array.isArray(req.files)
    ? req.files
    : Object.values(req.files || {}).flat();
  await storage.cleanupTempFiles(files);
}

/** Nombre de salida único para el flujo autenticado. */
function outputName() {
  return `convertido-${Date.now()}.pdf`;
}

/** Persiste varios archivos (split) en un jobDir y registra en el historial. */
async function persistParts(userId, buffers, type, inputName, nameFn) {
  const jobDir = await storage.createJobDir(userId);
  for (let i = 0; i < buffers.length; i++) {
    await storage.writeFile(jobDir, nameFn(i), buffers[i]);
  }
  const [id] = await db('conversions').insert({
    user_id: userId,
    type,
    input_filename: inputName,
    output_path: jobDir,
    size: buffers.reduce((acc, b) => acc + b.length, 0)
  });
  return id;
}

/** Persiste un único archivo y registra en el historial. */
async function persistSingle(userId, buffer, type, inputName, name) {
  const outPath = await storage.writeUserFile(userId, name, buffer);
  const [id] = await db('conversions').insert({
    user_id: userId,
    type,
    input_filename: inputName,
    output_path: outPath,
    size: buffer.length
  });
  return id;
}

module.exports = {
  filesOf,
  getInputBuffer,
  getInputBuffers,
  originalName,
  cleanupUploads,
  outputName,
  persistParts,
  persistSingle
};
