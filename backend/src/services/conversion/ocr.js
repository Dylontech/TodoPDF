'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { PDFDocument } = require('pdf-lib');

const config = require('../../config');
const { httpError } = require('../../utils/errors');
const { runCommand } = require('../../utils/exec');
const { countPages } = require('./pdfUtils');

/**
 * ─────────────────────────────────────────────────────────────
 * OCR de PDFs escaneados con tesseract (usado por PDF → Office).
 *
 * Un PDF escaneado (o una foto exportada a PDF) NO tiene capa de texto: al
 * importarlo con LibreOffice sólo se obtiene la foto de la página y el
 * documento resultante no tiene nada editable. Aquí se hace un OCR previo:
 *
 *   1. Ghostscript rasteriza cada página a PNG (en RAM, por stdin/stdout).
 *   2. tesseract reconoce el texto y genera un PDF "buscable": conserva la
 *      imagen de la página y añade el texto reconocido como capa invisible.
 *   3. Se unen las páginas y se devuelve un único PDF.
 *
 * El importador de PDF de LibreOffice extrae AMBAS cosas (imagen + texto),
 * así que el DOCX final sale con la página escaneada y con texto editable:
 * exactamente lo que se espera de una herramienta «PDF a Word».
 *
 * PRIVACIDAD: las imágenes y los PDFs intermedios viven en un directorio
 * temporal privado (bajo tempDir) que se borra SIEMPRE, incluso si falla.
 * ─────────────────────────────────────────────────────────────
 */

/** Idiomas instalados en la imagen (se resuelve una sola vez por proceso). */
let cachedLangs = null;
/** ¿Existe el binario de tesseract? (se resuelve una sola vez por proceso). */
let cachedAvailable = null;

/**
 * ¿Está tesseract instalado? Si no lo está, PDF → Office mantiene su
 * comportamiento anterior (el escaneo se convierte como imagen, sin texto)
 * en vez de romper la conversión entera.
 */
async function isAvailable() {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    await runCommand(config.ocr.tesseractPath, ['--version'], null, { timeoutMs: 15_000 });
    cachedAvailable = true;
  } catch {
    console.warn('[TodoPDF] tesseract no está disponible: los PDFs escaneados se convertirán sin OCR.');
    cachedAvailable = false;
  }
  return cachedAvailable;
}

/**
 * Lista los idiomas de tesseract realmente disponibles.
 * Si no se puede consultar, devuelve [] y se usará el idioma por defecto.
 */
async function availableLanguages() {
  if (cachedLangs) return cachedLangs;
  try {
    const { stdout, stderr } = await runCommand(config.ocr.tesseractPath, ['--list-langs'], null, {
      timeoutMs: 15_000
    });
    cachedLangs = `${stdout.toString()}\n${stderr}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[a-z][a-z0-9_]*$/i.test(line));
  } catch {
    cachedLangs = [];
  }
  return cachedLangs;
}

/**
 * Deja sólo los idiomas pedidos que estén instalados (p. ej. "spa+eng").
 * Si no queda ninguno, cae a inglés (si existe) o al idioma por defecto.
 */
async function resolveLanguages(requested) {
  const have = await availableLanguages();
  if (have.length === 0) return ''; // tesseract usará su valor por defecto
  const wanted = String(requested || '')
    .split('+')
    .map((l) => l.trim())
    .filter(Boolean);
  const usable = wanted.filter((l) => have.includes(l));
  if (usable.length > 0) return usable.join('+');
  return have.includes('eng') ? 'eng' : '';
}

/** Rasteriza una página del PDF a PNG (Ghostscript, todo por RAM). */
function renderPagePng(pdfBuffer, page, dpi) {
  const args = [
    '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE',
    '-sDEVICE=png16m',
    `-r${dpi}`,
    `-dFirstPage=${page}`,
    `-dLastPage=${page}`,
    '-sOutputFile=-', // salida por stdout → RAM
    '-'               // entrada por stdin → RAM
  ];
  return runCommand('gs', args, pdfBuffer).then((r) => r.stdout);
}

/**
 * Convierte un PDF sin capa de texto en un PDF "buscable" (imagen + texto
 * reconocido por OCR), listo para el importador de LibreOffice.
 *
 * @param {Buffer} pdfBuffer Contenido del PDF escaneado.
 * @param {object} [opts]    { dpi, languages } opcionales (por defecto, config).
 * @returns {Promise<Buffer>} PDF con las mismas páginas + capa de texto.
 */
async function ocrToSearchablePdf(pdfBuffer, opts = {}) {
  const pageCount = await countPages(pdfBuffer);
  if (pageCount > config.ocr.maxPages) {
    throw httpError(
      400,
      `El OCR de PDFs escaneados está disponible hasta ${config.ocr.maxPages} páginas ` +
        `(este PDF tiene ${pageCount}).`
    );
  }

  const dpi = Number(opts.dpi) || config.ocr.dpi;
  const languages = await resolveLanguages(opts.languages || config.ocr.languages);
  const workDir = await fs.mkdtemp(path.join(config.storage.tempDir, 'ocr-'));

  try {
    const out = await PDFDocument.create();

    for (let page = 1; page <= pageCount; page++) {
      const pngPath = path.join(workDir, `p${page}.png`);
      await fs.writeFile(pngPath, await renderPagePng(pdfBuffer, page, dpi));

      // Base del nombre de salida; tesseract escribe "<base>.pdf"
      const base = path.join(workDir, `p${page}`);
      const args = [pngPath, base, '--dpi', String(dpi)];
      if (languages) args.push('-l', languages);
      args.push('pdf');
      await runCommand(config.ocr.tesseractPath, args, null, {
        timeoutMs: config.ocr.timeoutMs,
        // Limita los hilos de OpenMP: tesseract puede acaparar toda la CPU
        // y dejar sin aire a LibreOffice/Ghostscript.
        env: { ...process.env, OMP_THREAD_LIMIT: '2' }
      });

      const pagePdf = await fs.readFile(`${base}.pdf`).catch(() => null);
      if (!pagePdf) throw httpError(500, `El OCR no pudo procesar la página ${page}.`);

      // copyPages es ASYNC y se invoca sobre el documento DESTINO.
      const [copied] = await out.copyPages(await PDFDocument.load(pagePdf), [0]);
      out.addPage(copied);
    }

    return Buffer.from(await out.save());
  } catch (err) {
    throw err.status ? err : httpError(500, `El OCR del PDF falló: ${err.message}`);
  } finally {
    // El directorio temporal se borra SIEMPRE (privacidad + espacio en disco)
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { ocrToSearchablePdf, availableLanguages, isAvailable };
