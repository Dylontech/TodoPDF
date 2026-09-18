'use strict';

const fontkit = require('@pdf-lib/fontkit');
const { PDFDocument, rgb } = require('pdf-lib');

const {
  CARD,
  COLORS,
  SIZES,
  IMAGE_MAX_HEIGHT,
  UnsupportedGlyphsError,
  wrapText,
  resolveFonts,
  deckText
} = require('./render');

/**
 * ─────────────────────────────────────────────────────────────
 * Exportación NATIVA a PDF con pdf-lib (sin LibreOffice).
 *
 * Una página A6 vertical por tarjeta + una portada con el título del mazo.
 * El texto se maqueta con una fuente TTF embebida (subset) porque las fuentes
 * estándar de PDF no incluyen acentos/ñ. Si esa fuente no cubre algún
 * carácter del mazo (emoji, CJK…) se lanza UnsupportedGlyphsError y el
 * exportador cae al camino de LibreOffice, que trae tipografías Noto.
 * ─────────────────────────────────────────────────────────────
 */

/** Color hex ('1e293b') → rgb() de pdf-lib. */
function color(hex) {
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Comprueba que la fuente cubre TODOS los caracteres del mazo.
 * pdf-lib dibuja silenciosamente un hueco cuando falta un glifo, así que la
 * detección se hace con fontkit antes de maquetar.
 */
function assertGlyphCoverage(fontBytes, fontPath, text) {
  const font = fontkit.create(fontBytes);
  const missing = new Set();
  for (const char of new Set(text)) {
    const codePoint = char.codePointAt(0);
    // Saltos de línea y tabuladores no son glifos imprimibles
    if (codePoint === 10 || codePoint === 13 || codePoint === 9) continue;
    if (!font.hasGlyphForCodePoint(codePoint)) missing.add(char);
  }
  if (missing.size > 0) {
    throw new UnsupportedGlyphsError([...missing].join(''), fontPath);
  }
}

/**
 * Genera el PDF del mazo.
 * @param {{title: string, description: string, cards: Array}} deckModel Modelo ya normalizado.
 * @returns {Promise<Buffer>}
 */
async function buildDeckPdf(deckModel) {
  const fonts = resolveFonts();
  assertGlyphCoverage(fonts.regular, fonts.regularPath, deckText(deckModel));
  if (fonts.boldPath !== fonts.regularPath) {
    assertGlyphCoverage(fonts.bold, fonts.boldPath, deckText(deckModel));
  }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  const contentWidth = CARD.width - CARD.margin * 2;
  const widthOf = (line, size, isBold) =>
    (isBold ? bold : font).widthOfTextAtSize(line, size);

  /** Dibuja un bloque de texto centrado y devuelve la Y final. */
  const drawBlock = (page, text, { size, isBold = false, y, lineFactor = 1.3, color: hex = COLORS.ink }) => {
    const face = isBold ? bold : font;
    const lines = wrapText(text, (line, s) => face.widthOfTextAtSize(line, s), size, contentWidth);
    const lineHeight = size * lineFactor;
    let cursor = y;
    for (const line of lines) {
      cursor -= lineHeight;
      if (!line) continue;
      const w = face.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: (CARD.width - w) / 2,
        y: cursor,
        size,
        font: face,
        color: color(hex)
      });
    }
    return cursor;
  };

  // ── Portada ────────────────────────────────────────────────
  const cover = doc.addPage([CARD.width, CARD.height]);
  const total = deckModel.cards.length;

  let coverY = CARD.height * 0.72;
  cover.drawRectangle({
    x: CARD.width / 2 - 28,
    y: coverY + 26,
    width: 56,
    height: 4,
    color: color(COLORS.accent)
  });

  coverY = drawBlock(cover, deckModel.title, { size: SIZES.coverTitle, isBold: true, y: coverY });

  if (deckModel.description) {
    coverY -= 10;
    coverY = drawBlock(cover, deckModel.description, {
      size: SIZES.coverMeta,
      y: coverY,
      color: COLORS.muted
    });
  }

  const meta = `${total} ${total === 1 ? 'tarjeta' : 'tarjetas'} · TodoPDF`;
  const metaWidth = font.widthOfTextAtSize(meta, SIZES.coverMeta);
  cover.drawText(meta, {
    x: (CARD.width - metaWidth) / 2,
    y: CARD.margin,
    size: SIZES.coverMeta,
    font,
    color: color(COLORS.muted)
  });

  // ── Una página por tarjeta ─────────────────────────────────
  for (const [index, card] of deckModel.cards.entries()) {
    const page = doc.addPage([CARD.width, CARD.height]);
    let y = CARD.height - CARD.margin;

    // Ilustración (arriba, centrada y sin deformar)
    if (card.image) {
      const png = await embedPng(doc, card.image);
      const scale = Math.min(
        IMAGE_MAX_HEIGHT / png.height,
        contentWidth / png.width
      );
      const w = png.width * scale;
      const h = png.height * scale;
      page.drawImage(png.image, {
        x: (CARD.width - w) / 2,
        y: y - h,
        width: w,
        height: h
      });
      y -= h + 18;
    }

    // Término (destacado y centrado)
    y = drawBlock(page, card.term, { size: SIZES.term, isBold: true, y, lineFactor: 1.25 });
    y -= 14;

    // Separador
    page.drawRectangle({
      x: CARD.margin + 46,
      y,
      width: contentWidth - 92,
      height: 1,
      color: color(COLORS.line)
    });
    y -= 16;

    // Definición: se reduce el tamaño lo justo para que siempre quepa
    const available = y - CARD.margin - 14;
    const definition = fitDefinition(card.definition, { available, widthOf });
    drawBlock(page, card.definition, {
      size: definition.size,
      y,
      lineFactor: 1.35,
      color: COLORS.muted
    });

    // Pie: progreso de la tarjeta
    const footer = `${index + 1} / ${total}`;
    const footerWidth = font.widthOfTextAtSize(footer, SIZES.footer);
    page.drawText(footer, {
      x: (CARD.width - footerWidth) / 2,
      y: CARD.margin - 12,
      size: SIZES.footer,
      font,
      color: color(COLORS.muted)
    });
  }

  return Buffer.from(await doc.save());
}

/** Elige el mayor tamaño de definición que cabe en el alto disponible. */
function fitDefinition(text, { available, widthOf }) {
  for (const size of [SIZES.definition, 11, 10, 9, 8]) {
    const lines = wrapText(text, widthOf, size, CARD.width - CARD.margin * 2);
    if (lines.length * size * 1.35 <= available || size === 8) return { size };
  }
  return { size: 8 };
}

/** Embebe un PNG (con caché por documento para no repetir la misma imagen). */
async function embedPng(doc, buffer) {
  const image = await doc.embedPng(buffer);
  return { image, width: image.width, height: image.height };
}

module.exports = { buildDeckPdf };
