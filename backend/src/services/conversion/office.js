'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const config = require('../../config');
const { detectFileType } = require('../../utils/files');
const { httpError } = require('../../utils/errors');
const { runCommand } = require('../../utils/exec');

/**
 * ─────────────────────────────────────────────────────────────
 * PDF ↔ Office con LibreOffice headless (soffice).
 *
 * LibreOffice NO puede procesar en puro RAM: necesita un directorio
 * de trabajo y un perfil de usuario. Por eso se crea un directorio
 * temporal PRIVADO por conversión (bajo config.storage.tempDir) que
 * se borra SIEMPRE al terminar (éxito o error), manteniendo así la
 * promesa de privacidad: nada persiste para invitados.
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Formatos de salida admitidos en PDF → Office, con su filtro LibreOffice.
 * El PDF se importa siempre con el filtro de Writer (writer_pdf_import) y se
 * re-exporta al formato elegido. XLSX/PPTX son "best effort": el texto se
 * vuelca a celdas/diapositivas y el layout puede no respetarse al 100%.
 */
const PDF_TARGET_FORMATS = {
  docx: {
    filter: 'MS Word 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  },
  doc: {
    filter: 'MS Word 97',
    mime: 'application/msword'
  },
  xlsx: {
    filter: 'Calc MS Excel 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  pptx: {
    filter: 'Impress MS PowerPoint 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  },
  odt: {
    filter: 'writer8',
    mime: 'application/vnd.oasis.opendocument.text'
  }
};

/** MIME de un formato de Office de salida (para el Content-Type de respuesta). */
function mimeForOffice(ext) {
  return (PDF_TARGET_FORMATS[ext] || {}).mime || 'application/octet-stream';
}

/**
 * Convierte un PDF → documento de Office (DOCX/DOC/XLSX/PPTX/ODT).
 *
 * @param {Buffer} pdfBuffer Contenido del PDF en memoria.
 * @param {string} targetExt Formato de salida (docx|doc|xlsx|pptx|odt).
 * @returns {Promise<Buffer>} El documento Office convertido.
 */
async function pdfToOffice(pdfBuffer, targetExt) {
  const fmt = PDF_TARGET_FORMATS[targetExt];
  if (!fmt) throw httpError(400, `Formato de Office no soportado: "${targetExt}".`);

  const type = await detectFileType(pdfBuffer);
  if (!type || type.mime !== 'application/pdf') {
    throw httpError(400, 'El archivo debe ser un PDF válido.');
  }

  return runSoffice({
    input: pdfBuffer,
    inputName: 'input.pdf',
    // El PDF siempre se importa con el filtro de Writer
    infilter: 'writer_pdf_import',
    convertTo: `${targetExt}:${fmt.filter}`,
    outputName: `input.${targetExt}`
  });
}

/**
 * Convierte un documento de Office → PDF.
 * El formato de entrada se detecta por magic bytes (nunca por extensión).
 *
 * @param {Buffer} officeBuffer Contenido del documento Office en memoria.
 * @returns {Promise<Buffer>} El PDF resultante.
 */
async function officeToPdf(officeBuffer) {
  const type = await detectFileType(officeBuffer);
  const ext = extensionForMime(type && type.mime);
  if (!ext) {
    throw httpError(400, 'El archivo debe ser un documento de Office (DOCX, DOC, XLSX, PPTX u ODT).');
  }

  return runSoffice({
    input: officeBuffer,
    inputName: `input.${ext}`,
    infilter: null,
    convertTo: 'pdf:writer_pdf_Export',
    outputName: 'input.pdf'
  });
}

/** MIME (detectado por file-type) → extensión de documento Office admitida. */
function extensionForMime(mime) {
  const map = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.oasis.opendocument.text': 'odt'
  };
  return map[mime] || null;
}

/**
 * Ejecuta LibreOffice headless sobre un directorio de trabajo privado.
 *
 * - Perfil de usuario (UserInstallation) ÚNICO por ejecución: evita el
 *   bloqueo de perfil cuando hay conversiones concurrentes.
 * - Timeout anti-DoS generoso: el arranque en frío de LO tarda varios segundos.
 * - El directorio temporal se elimina SIEMPRE en `finally`.
 */
async function runSoffice({ input, inputName, infilter, convertTo, outputName }) {
  const workDir = await fs.mkdtemp(path.join(config.storage.tempDir, 'office-'));
  const inputPath = path.join(workDir, inputName);
  const outputPath = path.join(workDir, outputName);
  const profileUrl = pathToFileURL(path.join(workDir, 'profile')).href;

  try {
    await fs.writeFile(inputPath, input);

    const args = [
      '--headless',
      '--norestore',
      '--invisible',
      '--nofirststartwizard',
      '--nologo',
      `-env:UserInstallation=${profileUrl}`,
      '--convert-to', convertTo,
      '--outdir', workDir
    ];
    if (infilter) args.push('--infilter', infilter);
    args.push(inputPath);

    // stdin no se usa: LibreOffice lee el archivo del directorio de trabajo.
    await runCommand(config.office.sofficePath, args, null, {
      timeoutMs: config.office.timeoutMs
    });

    const out = await fs.readFile(outputPath).catch(() => null);
    if (!out) {
      throw httpError(500, 'LibreOffice no pudo generar el archivo de salida.');
    }
    return out;
  } catch (err) {
    // Preserva el estado HTTP si ya es un error tipado; si no, 500 genérico.
    throw err.status ? err : httpError(500, `La conversión de Office falló: ${err.message}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { pdfToOffice, officeToPdf, mimeForOffice, PDF_TARGET_FORMATS };
