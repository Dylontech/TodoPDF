'use strict';

const pLimit = require('p-limit');

const config = require('../config');
const { removeBackground } = require('../services/conversion/removeBackground');
const {
  getInputBuffer,
  originalName,
  cleanupUploads,
  persistSingle
} = require('./helpers');

/**
 * Controlador de "Quitar fondo de imagen" (rembg/u2net).
 *
 * Sección EXCLUSIVA para usuarios autenticados (requireAuth en la ruta):
 * el resultado se guarda en /data/storage/<usuario>, se registra en el
 * historial (tabla conversions, type 'remove-bg') y se responde { id }.
 * La descarga usa la ruta genérica /api/convert/:id/download (solo dueño).
 */

// rembg es pesado en CPU/RAM: concurrencia limitada (1 por defecto).
const limit = pLimit(config.removeBg.maxConcurrency);

/** POST /api/remove-bg — elimina el fondo y devuelve el PNG transparente. */
async function removeBg(req, res, next) {
  const userId = req.session.userId;
  try {
    const inputBuffer = await getInputBuffer(req);
    const inputName = originalName(req);
    const out = await limit(() => removeBackground(inputBuffer));

    const name = `fondo-removido-${Date.now()}.png`;
    const id = await persistSingle(userId, out, 'remove-bg', inputName, name);
    return res.status(201).json({ id, name, size: out.length });
  } catch (err) {
    next(err);
  } finally {
    await cleanupUploads(req);
  }
}

module.exports = { removeBg };
