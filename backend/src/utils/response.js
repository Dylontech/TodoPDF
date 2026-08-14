'use strict';

const archiver = require('archiver');

/**
 * Helpers de respuesta para el flujo INVITADO (respuesta directa en RAM).
 * Compartidos por convertController y pdfToolsController.
 */

/**
 * Envía un archivo único directo con cabeceras de descarga.
 * @param {object} res     Respuesta Express.
 * @param {Buffer} buffer  Contenido del archivo.
 * @param {string} name    Nombre de descarga (con extensión).
 * @param {string} mime    Content-Type.
 */
function sendSingleFile(res, buffer, name, mime) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
  res.send(buffer);
}

/**
 * Envía un ZIP construido en memoria (archiver → stream a la respuesta).
 *
 * @param {object} res  Respuesta Express.
 * @param {object} opts {
 *   buffers:  Buffer[],
 *   baseName: nombre base del ZIP y prefijo de los ítems,
 *   nameFn?:  (i) => string — nombre de cada ítem (si se omite usa baseName-prefijo-NN.ext),
 *   prefix?:  prefijo por defecto (default 'pagina'),
 *   ext?:     extensión por defecto (default '')
 * }
 */
function sendZip(res, { buffers, baseName, nameFn, prefix = 'pagina', ext = '' }) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => res.destroy(err));

  buffers.forEach((buf, i) => {
    const name = nameFn
      ? nameFn(i)
      : `${baseName}-${prefix}-${String(i + 1).padStart(2, '0')}${ext ? '.' + ext : ''}`;
    archive.append(buf, { name });
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}.zip"`);
  archive.pipe(res);
  archive.finalize();
}

module.exports = { sendSingleFile, sendZip };
