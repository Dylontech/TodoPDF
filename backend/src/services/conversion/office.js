'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');
const pptxgen = require('pptxgenjs');

const config = require('../../config');
const { detectFileType } = require('../../utils/files');
const { httpError } = require('../../utils/errors');
const { runCommand } = require('../../utils/exec');
const { pdfToImages } = require('./pdfToImages');

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
 * Formatos de salida admitidos en PDF → Office.
 *
 * - mode 'writer' (docx/doc/odt): LibreOffice importa el PDF con el filtro de
 *   Writer (writer_pdf_import) y lo re-exporta. Exportar un documento Writer a
 *   XLSX/PPTX hace que LibreOffice aborte (SIGABRT, código 134), por eso los
 *   formatos de presentación usan otra ruta.
 * - mode 'slides' (pptx): la página se rasteriza a PNG y se embebe como
 *   diapositiva con pptxgenjs (ruta fiable para presentaciones).
 * - mode 'slides-ppt' (ppt): PPTX generado y reconvertido a PPT binario con
 *   LibreOffice (Impress → Impress, que sí funciona).
 */
const PDF_TARGET_FORMATS = {
  docx: { mode: 'writer', filter: 'MS Word 2007 XML', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  doc: { mode: 'writer', filter: 'MS Word 97', mime: 'application/msword' },
  odt: { mode: 'writer', filter: 'writer8', mime: 'application/vnd.oasis.opendocument.text' },
  pptx: { mode: 'slides', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  ppt: { mode: 'slides-ppt', mime: 'application/vnd.ms-powerpoint' }
};

/** MIME de un formato de Office de salida (para el Content-Type de respuesta). */
function mimeForOffice(ext) {
  return (PDF_TARGET_FORMATS[ext] || {}).mime || 'application/octet-stream';
}

/**
 * Convierte un PDF → documento de Office.
 * Formatos de salida: docx/doc/odt (procesador de textos vía LibreOffice Writer)
 * y pptx/ppt (presentaciones: una diapositiva por página con la página como imagen).
 *
 * @param {Buffer} pdfBuffer Contenido del PDF en memoria.
 * @param {string} targetExt Formato de salida (docx|doc|odt|pptx|ppt).
 * @returns {Promise<Buffer>} El documento Office convertido.
 */
async function pdfToOffice(pdfBuffer, targetExt) {
  const fmt = PDF_TARGET_FORMATS[targetExt];
  if (!fmt) throw httpError(400, `Formato de Office no soportado: "${targetExt}".`);

  const type = await detectFileType(pdfBuffer);
  if (!type || type.mime !== 'application/pdf') {
    throw httpError(400, 'El archivo debe ser un PDF válido.');
  }

  // Presentaciones: diapositiva por página (ruta con imágenes, no Writer)
  if (fmt.mode === 'slides') return pdfToPptx(pdfBuffer);
  if (fmt.mode === 'slides-ppt') return pdfToPpt(pdfBuffer);

  // Procesadores de texto (docx/doc/odt): import Writer + export del filtro
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
    // Los .doc son contenedores CFB/OLE2; file-type los reporta así (según build)
    'application/msword': 'doc',
    'application/x-cfb': 'doc',
    'application/x-ole-storage': 'doc',
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
    // --infilter debe ir como argumento único (--infilter=<filtro>),
    // no como dos tokens separados (LibreOffice lo rechaza).
    if (infilter) args.push(`--infilter=${infilter}`);
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

/**
 * Convierte PDF → PPTX generando una diapositiva por página, con la página
 * rasterizada como imagen a pantalla completa. Usa Ghostscript (reutiliza
 * pdfToImages) + pptxgenjs, porque LibreOffice no puede exportar Writer→PPTX.
 *
 * @param {Buffer} pdfBuffer Contenido del PDF en memoria.
 * @returns {Promise<Buffer>} PPTX (una imagen por diapositiva).
 */
async function pdfToPptx(pdfBuffer) {
  // Rasteriza cada página a PNG en RAM (valida magic bytes y maxPages)
  const pages = await pdfToImages(pdfBuffer, { format: 'png' });
  if (pages.length === 0) throw httpError(400, 'El PDF no tiene páginas.');

  try {
    const pres = new pptxgen();

    // Lienzo ajustado al aspecto de la primera página (evita distorsión)
    const meta = await sharp(pages[0]).metadata();
    const ratio = (meta.width || 1000) / (meta.height || 1000);
    let w = 10;
    let h = w / ratio;
    if (h > 7.5) { h = 7.5; w = h * ratio; }
    pres.defineLayout({ name: 'PDF', width: w, height: h });
    pres.layout = 'PDF';

    for (const page of pages) {
      const slide = pres.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addImage({
        data: `data:image/png;base64,${page.toString('base64')}`,
        x: 0, y: 0, w, h,
        sizing: { type: 'contain', w, h }
      });
    }

    // Nota: pres.stream() usa nodebuffer (jszip). write('buffer') pasa el tipo
    // literal 'buffer' a jszip y falla ("buffer is not supported by this platform").
    const out = await pres.stream();
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } finally {
    pages.length = 0; // libera las imágenes para el GC antes de finalizar
  }
}

/**
 * Convierte PDF → PPT (formato binario antiguo): genera el PPTX con una
 * diapositiva por página y lo reconvierte a .ppt con LibreOffice
 * (Impress → Impress, que sí es fiable).
 */
async function pdfToPpt(pdfBuffer) {
  const pptx = await pdfToPptx(pdfBuffer);
  return runSoffice({
    input: pptx,
    inputName: 'input.pptx',
    infilter: null,
    convertTo: 'ppt:MS PowerPoint 97',
    outputName: 'input.ppt'
  });
}

module.exports = { pdfToOffice, officeToPdf, mimeForOffice, PDF_TARGET_FORMATS };
