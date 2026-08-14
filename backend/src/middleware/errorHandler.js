'use strict';

const config = require('../config');

/** Ruta inexistente. */
function notFound(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado.' });
}

/**
 * Manejador central de errores.
 * En desarrollo incluye el detalle; en producción un mensaje genérico.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Errores de Multer: tamaño máximo superado
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el tamaño máximo permitido.' });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: `Error de subida: ${err.message}` });
  }
  // Error de JSON inválido en el cuerpo
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido en el cuerpo de la petición.' });
  }

  const status = err.status || 500;
  const message = config.env === 'production' ? 'Error interno del servidor.' : err.message;

  // Registro en el servidor (sin exponer detalles sensibles al cliente)
  console.error('[TodoPDF:error]', err);

  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
