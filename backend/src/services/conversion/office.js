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
const { assertPdfReadable, isScannedPdf } = require('./pdfUtils');
const { ocrToSearchablePdf, isAvailable: isOcrAvailable } = require('./ocr');
const {
  OFFICE_FORMATS,
  OUTPUT_FORMATS,
  INPUT_LABEL,
  mimeForExt,
  detectOfficeKind,
  isSupportedPair,
  outputsFor,
  convertToArg,
  familyLabel
} = require('./officeFormats');

/**
 * ─────────────────────────────────────────────────────────────
 * PDF ↔ Office y Office ↔ Office con LibreOffice headless (soffice).
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

/**
 * MIME de un formato de Office de salida (para el Content-Type de respuesta).
 * La tabla de MIME vive en officeFormats.js (fuente única).
 */
function mimeForOffice(ext) {
  return mimeForExt(ext);
}

/**
 * Convierte un PDF → documento de Office.
 * Formatos de salida: docx/doc/odt (procesador de textos vía LibreOffice Writer)
 * y pptx/ppt (presentaciones: una diapositiva por página con la página como imagen).
 *
 * @param {Buffer} pdfBuffer Contenido del PDF en memoria.
 * @param {string} targetExt Formato de salida (docx|doc|odt|pptx|ppt).
 * @param {object} [opts]    { ocr: 'auto'|'on'|'off' } — control del OCR de
 *   escaneos. 'auto' (por defecto) decide según la capa de texto del PDF,
 *   'on' lo fuerza y 'off' lo desactiva (el escaneo queda como imagen).
 * @returns {Promise<Buffer>} El documento Office convertido.
 */
async function pdfToOffice(pdfBuffer, targetExt, opts = {}) {
  const fmt = PDF_TARGET_FORMATS[targetExt];
  if (!fmt) throw httpError(400, `Formato de Office no soportado: "${targetExt}".`);

  const type = await detectFileType(pdfBuffer);
  if (!type || type.mime !== 'application/pdf') {
    throw httpError(400, 'El archivo debe ser un PDF válido.');
  }
  // Los PDFs con contraseña no los puede abrir ni LibreOffice ni Ghostscript:
  // se avisa con un 400 claro en vez de fallar más adelante con un 500.
  await assertPdfReadable(pdfBuffer);

  // Presentaciones: diapositiva por página (ruta con imágenes, no Writer)
  if (fmt.mode === 'slides') return pdfToPptx(pdfBuffer);
  if (fmt.mode === 'slides-ppt') return pdfToPpt(pdfBuffer);

  // PDF escaneado (sin capa de texto útil): se hace OCR ANTES de importarlo.
  // El OCR devuelve un PDF "buscable" (imagen + texto invisible) y el
  // importador de LibreOffice extrae las dos cosas → el documento final tiene
  // la página como imagen Y el texto editable. Sin esto, un escaneo daba un
  // DOCX sin texto (o sólo con el sello del escáner).
  const ocrMode = opts.ocr === 'on' || opts.ocr === 'off' ? opts.ocr : 'auto';
  const needsOcr =
    ocrMode === 'on' ? true : ocrMode === 'off' ? false : await isScannedPdf(pdfBuffer);

  let input = pdfBuffer;
  if (needsOcr) {
    if (await isOcrAvailable()) {
      input = await ocrToSearchablePdf(pdfBuffer);
    } else if (ocrMode === 'on') {
      // Se pidió OCR explícitamente y el servidor no puede hacerlo.
      throw httpError(400, 'El OCR no está disponible en este servidor.');
    }
  }

  // Procesadores de texto (docx/doc/odt): import Writer + export del filtro
  return runSoffice({
    input,
    inputName: 'input.pdf',
    // El PDF siempre se importa con el filtro de Writer
    infilter: 'writer_pdf_import',
    convertTo: `${targetExt}:${fmt.filter}`,
    outputName: `input.${targetExt}`
  });
}

/**
 * Convierte un documento de Office a OTRO formato de Office (o a PDF).
 *
 * El formato de entrada se detecta por magic bytes (nunca por extensión): los
 * .doc/.xls/.ppt comparten contenedor CFB y se distinguen mirando dentro
 * (ver detectOfficeKind). La extensión del archivo temporal es la que hace que
 * LibreOffice elija el filtro de importación correcto.
 *
 * Solo se permiten conversiones dentro de la MISMA familia (writer → writer,
 * calc → calc, impress → impress) y a PDF desde cualquier familia.
 *
 * @param {Buffer} officeBuffer Contenido del documento en memoria.
 * @param {string} targetExt Formato de salida (docx, odt, doc, rtf, txt, xlsx,
 *   ods, xls, csv, pptx, odp, ppt, pdf).
 * @param {string} [declaredName] Nombre original (último recurso de detección).
 * @returns {Promise<Buffer>} El documento convertido.
 */
async function officeToOffice(officeBuffer, targetExt, declaredName = '') {
  const target = String(targetExt || '').toLowerCase().replace(/^\./, '');
  const fmt = OFFICE_FORMATS[target];
  if (!fmt) {
    throw httpError(400, `Formato de salida no soportado: "${targetExt}". Permitidos: ${OUTPUT_FORMATS.join(', ')}.`);
  }

  const source = await detectOfficeKind(officeBuffer, declaredName);
  if (!source) {
    throw httpError(400, `El archivo debe ser un documento de Office (${INPUT_LABEL}).`);
  }
  if (source.ext === 'pdf') {
    throw httpError(400, 'El archivo ya es un PDF. Para PDF → Office usa la herramienta «PDF a Office».');
  }
  if (source.ext === target) {
    throw httpError(400, `El archivo ya está en formato ${target.toUpperCase()}: elige otro formato de salida.`);
  }
  if (!isSupportedPair(source.ext, target)) {
    throw httpError(
      400,
      `No se puede convertir ${source.ext.toUpperCase()} a ${target.toUpperCase()}: son familias distintas. ` +
        `Para un ${familyLabel(source.family)} los formatos válidos son ${outputsFor(source.ext)
          .join(', ')
          .toUpperCase()}.`
    );
  }

  return runSoffice({
    input: officeBuffer,
    inputName: `input.${source.ext}`,
    infilter: null,
    convertTo: convertToArg(target, source.family),
    outputName: `input.${target}`
  });
}

/**
 * Convierte un documento de Office → PDF, usando el filtro de exportación
 * de la familia de origen (Writer/Calc/Impress).
 *
 * @param {Buffer} officeBuffer Contenido del documento Office en memoria.
 * @param {string} [declaredName] Nombre original (último recurso de detección).
 * @returns {Promise<Buffer>} El PDF resultante.
 */
async function officeToPdf(officeBuffer, declaredName = '') {
  return officeToOffice(officeBuffer, 'pdf', declaredName);
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
    // LC_ALL=C.UTF-8: en contenedores con locale C (POSIX) LibreOffice usa un
    // charset ASCII/Latin-1 para txt/csv → acentos y eñes saldrían corruptos.
    await runCommand(config.office.sofficePath, args, null, {
      timeoutMs: config.office.timeoutMs,
      env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' }
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

module.exports = {
  pdfToOffice,
  officeToPdf,
  officeToOffice,
  mimeForOffice,
  mimeForExt,
  OFFICE_FORMATS,
  OUTPUT_FORMATS,
  PDF_TARGET_FORMATS,
  // Reutilizado por la exportación de flashcards (respaldo PPTX → PDF)
  runSoffice
};
