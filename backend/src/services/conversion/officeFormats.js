'use strict';

const path = require('node:path');

const { detectFileType, sniffCfbKind } = require('../../utils/files');

/**
 * ─────────────────────────────────────────────────────────────
 * Tabla de formatos de Office y detección de documentos.
 *
 * Fuente ÚNICA de la herramienta «Convertir documento»
 * (POST /api/convert/office-to-office); también la usan las
 * conversiones PDF ↔ Office para el Content-Type de las
 * descargas.
 *
 * Reglas de compatibilidad: un documento solo se convierte dentro
 * de su propia FAMILIA (writer/calc/impress), porque LibreOffice
 * usa un módulo distinto para cada una. Cualquier familia puede
 * exportarse además a PDF.
 * ─────────────────────────────────────────────────────────────
 */

/** Familias de documento (módulo de LibreOffice que las procesa). */
const FAMILIES = {
  writer: { label: 'procesador de textos', module: 'LibreOffice Writer' },
  calc: { label: 'hoja de cálculo', module: 'LibreOffice Calc' },
  impress: { label: 'presentación', module: 'LibreOffice Impress' }
};

/**
 * Formatos soportados.
 *   family        → familia del documento (writer|calc|impress|null para PDF)
 *   exportFilter  → nombre del filtro de exportación de LibreOffice
 *   filterOptions → opciones del filtro (se añaden tras otro «:»)
 *   pdfFilters    → filtro de exportación a PDF según la familia de origen
 *   mime          → Content-Type de la descarga
 *
 * El ORDEN de las claves importa para el frontend: es el orden en el que
 * aparecen las opciones del selector de salida, con el equivalente moderno
 * primero (doc→DOCX, odt→DOCX, xls→XLSX, ppt→PPTX…).
 */
const OFFICE_FORMATS = {
  // ── Procesador de textos ─────────────────────────────────
  docx: {
    family: 'writer',
    exportFilter: 'MS Word 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  },
  odt: {
    family: 'writer',
    exportFilter: 'writer8',
    mime: 'application/vnd.oasis.opendocument.text'
  },
  doc: { family: 'writer', exportFilter: 'MS Word 97', mime: 'application/msword' },
  rtf: { family: 'writer', exportFilter: 'Rich Text Format', mime: 'application/rtf' },
  txt: {
    family: 'writer',
    exportFilter: 'Text (encoded)',
    // El token debe ser el nombre del charset ('UTF-8', no 'UTF8'): con 'UTF8'
    // LibreOffice cae a un charset del sistema, añade BOM y corrompe acentos.
    filterOptions: 'UTF-8',
    mime: 'text/plain; charset=utf-8'
  },

  // ── Hojas de cálculo ─────────────────────────────────────
  xlsx: {
    family: 'calc',
    exportFilter: 'Calc MS Excel 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  ods: {
    family: 'calc',
    exportFilter: 'calc8',
    mime: 'application/vnd.oasis.opendocument.spreadsheet'
  },
  xls: { family: 'calc', exportFilter: 'MS Excel 97', mime: 'application/vnd.ms-excel' },
  csv: {
    family: 'calc',
    exportFilter: 'Text - txt - csv (StarCalc)',
    // 44=coma, 34=comillas, 76=UTF-8, 1=primera línea, (formato de celda),
    // (idioma), 0=no entrecomillar todo como texto, false=no detectar números
    // especiales, true=mostrar el contenido tal cual, true=exportar valores
    // (sin las 10 opciones, LibreOffice entrecomilla todas las celdas de texto).
    filterOptions: '44,34,76,1,,0,false,true,true',
    mime: 'text/csv; charset=utf-8'
  },

  // ── Presentaciones ───────────────────────────────────────
  pptx: {
    family: 'impress',
    exportFilter: 'Impress MS PowerPoint 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  },
  odp: {
    family: 'impress',
    exportFilter: 'impress8',
    mime: 'application/vnd.oasis.opendocument.presentation'
  },
  ppt: { family: 'impress', exportFilter: 'MS PowerPoint 97', mime: 'application/vnd.ms-powerpoint' },

  // ── PDF (salida común a todas las familias) ──────────────
  pdf: {
    family: null,
    exportFilter: null,
    pdfFilters: {
      writer: 'writer_pdf_Export',
      calc: 'calc_pdf_Export',
      impress: 'impress_pdf_Export'
    },
    mime: 'application/pdf'
  }
};

/** Extensiones → familia (derivada de la tabla). */
const FAMILY_OF = Object.fromEntries(
  Object.entries(OFFICE_FORMATS).map(([ext, fmt]) => [ext, fmt.family])
);

/** Formatos que puede tener un archivo de ENTRADA (todos menos PDF). */
const INPUT_FORMATS = Object.keys(OFFICE_FORMATS).filter((ext) => ext !== 'pdf');

/** Formatos de SALIDA admitidos. */
const OUTPUT_FORMATS = Object.keys(OFFICE_FORMATS);

/** Etiqueta legible de los formatos de entrada (para mensajes de error). */
const INPUT_LABEL = 'DOC, DOCX, ODT, RTF, TXT, XLS, XLSX, ODS, CSV, PPT, PPTX u ODP';

/** MIME de resultados que no son de Office (herramientas de imagen). */
const EXTRA_MIMES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml'
};

/** MIME → extensión (inverso de la tabla, para la detección por magic bytes). */
const EXT_FOR_MIME = Object.fromEntries(
  Object.entries(OFFICE_FORMATS).map(([ext, fmt]) => [fmt.mime, ext])
);

/** MIMEs de contenedor CFB (doc/xls/ppt indistinguibles sin mirar dentro). */
const CFB_MIMES = new Set(['application/x-cfb', 'application/x-ole-storage']);

/** MIMEs de ZIP genérico (contenedor cuyo interior file-type no reconoció). */
const ZIP_MIMES = new Set(['application/zip', 'application/x-zip-compressed']);

/** Formatos de texto plano: no tienen magic bytes → se validan por contenido. */
const TEXT_INPUTS = new Set(['txt', 'csv']);

/** Extensiones ZIP válidas (OOXML de Microsoft y OpenDocument de LibreOffice). */
const ZIP_INPUTS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

/** Contenedores CFB válidos (Office 97-2003). */
const CFB_INPUTS = new Set(['doc', 'xls', 'ppt']);

/** MIME de descarga de un resultado (Office, imágenes o binario genérico). */
function mimeForExt(ext) {
  const key = String(ext || '').toLowerCase().replace('.', '');
  return (OFFICE_FORMATS[key] && OFFICE_FORMATS[key].mime) || EXTRA_MIMES[key] || 'application/octet-stream';
}

/** Normaliza una extensión declarada (solo alfanuméricos, sin punto). */
function normalizeExt(value) {
  const ext = String(value || '').toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]+$/.test(ext) ? ext : '';
}

/** Extensión de un nombre de archivo declarado por el cliente. */
function extensionOf(filename) {
  return normalizeExt(path.extname(String(filename || '')));
}

/** ¿El buffer empieza por la firma de un ZIP? (`PK\x03\x04`, `PK\x05\x06`, `PK\x07\x08`) */
function hasZipMagic(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

/** ¿Parece texto plano? (sin bytes NUL en la muestra) */
function looksLikeText(buffer) {
  const sample = buffer.length > 8192 ? buffer.subarray(0, 8192) : buffer;
  return sample.indexOf(0) === -1;
}

/**
 * Detecta el tipo real de un documento de Office sin fiarse de la extensión.
 *
 * Orden de resolución:
 *  1. Contenedor CFB → sniffing interno (doc/xls/ppt) y, si falla, la
 *     extensión declarada (solo si es una extensión CFB válida).
 *  2. MIME oficial de file-type (OOXML, OpenDocument, RTF, PDF).
 *  3. ZIP que file-type no reconoce → extensión declarada + firma ZIP.
 *  4. Texto plano (txt/csv): no tienen magic bytes.
 *
 * @param {Buffer} buffer Contenido del archivo.
 * @param {string} [declaredName] Nombre original (solo como último recurso).
 * @returns {Promise<{ext: string, family: string|null, source: 'magic'|'extension'}|null>}
 */
async function detectOfficeKind(buffer, declaredName = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  const declared = extensionOf(declaredName);
  const type = await detectFileType(buffer);
  const mime = (type && type.mime) || null;

  // 1) CFB: doc/xls/ppt comparten contenedor → hay que mirar dentro
  if (mime && CFB_MIMES.has(mime)) {
    const kind = sniffCfbKind(buffer);
    const ext = kind || (CFB_INPUTS.has(declared) ? declared : '');
    if (!ext) return null;
    return { ext, family: FAMILY_OF[ext] || null, source: kind ? 'magic' : 'extension' };
  }

  // 2) MIME conocido (docx/xlsx/pptx/odt/ods/odp/rtf/pdf)
  if (mime && EXT_FOR_MIME[mime]) {
    const ext = EXT_FOR_MIME[mime];
    return { ext, family: FAMILY_OF[ext] || null, source: 'magic' };
  }

  // 3) ZIP genérico (zip mal formado o con entradas en orden no esperado)
  if (mime && ZIP_MIMES.has(mime) && ZIP_INPUTS.has(declared) && hasZipMagic(buffer)) {
    return { ext: declared, family: FAMILY_OF[declared] || null, source: 'extension' };
  }

  // 4) Texto plano (txt/csv)
  if (!mime && TEXT_INPUTS.has(declared) && looksLikeText(buffer)) {
    return { ext: declared, family: FAMILY_OF[declared] || null, source: 'extension' };
  }

  return null;
}

/**
 * ¿Es una conversión permitida?
 * Dentro de la misma familia siempre; a PDF desde cualquier familia.
 * Nunca desde PDF, ni a la misma extensión.
 */
function isSupportedPair(srcExt, targetExt) {
  if (!OFFICE_FORMATS[srcExt] || !OFFICE_FORMATS[targetExt]) return false;
  if (srcExt === 'pdf' || srcExt === targetExt) return false;
  if (targetExt === 'pdf') return true;
  return FAMILY_OF[srcExt] === FAMILY_OF[targetExt];
}

/** Formatos de salida válidos para una entrada concreta. */
function outputsFor(srcExt) {
  return OUTPUT_FORMATS.filter((ext) => isSupportedPair(srcExt, ext));
}

/**
 * Argumento `--convert-to` de LibreOffice para una conversión.
 * Ej.: `docx:MS Word 2007 XML`, `csv:Text - txt - csv (StarCalc):44,34,76,1`.
 */
function convertToArg(targetExt, sourceFamily) {
  const fmt = OFFICE_FORMATS[targetExt];
  if (!fmt) return null;
  const filter =
    targetExt === 'pdf'
      ? (fmt.pdfFilters || {})[sourceFamily] || 'writer_pdf_Export'
      : fmt.exportFilter;
  return fmt.filterOptions
    ? `${targetExt}:${filter}:${fmt.filterOptions}`
    : `${targetExt}:${filter}`;
}

/** Etiqueta legible de una familia (para mensajes de error). */
function familyLabel(family) {
  return (FAMILIES[family] && FAMILIES[family].label) || 'documento';
}

module.exports = {
  FAMILIES,
  OFFICE_FORMATS,
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  INPUT_LABEL,
  mimeForExt,
  normalizeExt,
  extensionOf,
  detectOfficeKind,
  isSupportedPair,
  outputsFor,
  convertToArg,
  familyLabel
};
