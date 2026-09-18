'use strict';

const config = require('../config');

/** Ruta inexistente. */
function notFound(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado.' });
}

/**
 * En producción el detalle del error se oculta al cliente; para diagnosticar
 * sin acceso a la terminal se puede activar TODOPDF_DEBUG_ERRORS=true, que
 * añade code/message reales a la respuesta 500.
 */
const exposeErrors = process.env.TODOPDF_DEBUG_ERRORS === 'true';

/**
 * Manejador central de errores.
 * En desarrollo incluye el detalle; en producción un mensaje genérico
 * (o el detalle si TODOPDF_DEBUG_ERRORS=true).
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
  // Los errores 4xx son de VALIDACIÓN: su mensaje está escrito para el usuario
  // («El PDF está protegido con contraseña», «supera el límite de 100 páginas»,
  // «formato no soportado»…) y por eso se muestra SIEMPRE. Si se enmascarara,
  // el usuario sólo vería «Error interno del servidor» sin saber qué corregir.
  // Los 5xx sí se ocultan en producción para no filtrar detalles internos
  // (salvo TODOPDF_DEBUG_ERRORS=true, pensado para diagnosticar sin terminal).
  const isServerError = status >= 500;
  const message =
    !isServerError || config.env !== 'production' || exposeErrors
      ? err.message
      : 'Error interno del servidor.';

  // Registro en el servidor (sin exponer detalles sensibles al cliente)
  console.error('[TodoPDF:error]', err);

  const body = { error: message };
  if (exposeErrors && err.code) body.code = err.code;
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
