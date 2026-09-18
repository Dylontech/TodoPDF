'use strict';

const pptxgen = require('pptxgenjs');

const { CARD, COLORS, SIZES, IMAGE_MAX_HEIGHT, PT_PER_IN } = require('./render');

/**
 * ─────────────────────────────────────────────────────────────
 * Exportación a PowerPoint (pptxgenjs) y origen del PDF de respaldo.
 *
 * Una diapositiva A6 vertical (105 × 148 mm) por tarjeta + diapositiva de
 * portada. El lienzo es exactamente la página A6, así que LibreOffice
 * (Impress) lo exporta a un PDF de una tarjeta por página sin reescalados.
 * ─────────────────────────────────────────────────────────────
 */

const IN = (pt) => pt / PT_PER_IN;
const CONTENT_W = IN(CARD.width - CARD.margin * 2);

/** Bloque de texto centrado que se encoge si no cabe (fit: 'shrink'). */
function textBlock(slide, text, { y, h, size, bold = false, color = COLORS.ink }) {
  slide.addText(text, {
    x: IN(CARD.margin),
    y,
    w: CONTENT_W,
    h,
    fontSize: size,
    bold,
    color,
    align: 'center',
    valign: 'middle',
    fit: 'shrink',
    isTextBox: true,
    fontFace: 'DejaVu Sans'
  });
}

/**
 * Construye el PPTX del mazo.
 * @param {{title: string, description: string, cards: Array}} deckModel Modelo normalizado.
 * @returns {Promise<Buffer>}
 */
async function buildDeckPptx(deckModel) {
  const pres = new pptxgen();
  pres.defineLayout({ name: 'CARD_A6', width: CARD.widthIn, height: CARD.heightIn });
  pres.layout = 'CARD_A6';

  const total = deckModel.cards.length;

  // ── Portada ────────────────────────────────────────────────
  const cover = pres.addSlide();
  cover.background = { color: COLORS.white };
  cover.addShape(pres.ShapeType.rect, {
    x: CARD.widthIn / 2 - IN(28),
    y: IN(CARD.height * 0.28),
    w: IN(56),
    h: IN(4),
    fill: { color: COLORS.accent }
  });
  textBlock(cover, deckModel.title, {
    y: IN(CARD.height * 0.32),
    h: IN(CARD.height * 0.3),
    size: SIZES.coverTitle,
    bold: true
  });
  if (deckModel.description) {
    textBlock(cover, deckModel.description, {
      y: IN(CARD.height * 0.62),
      h: IN(CARD.height * 0.2),
      size: SIZES.coverMeta,
      color: COLORS.muted
    });
  }
  textBlock(cover, `${total} ${total === 1 ? 'tarjeta' : 'tarjetas'} · TodoPDF`, {
    y: CARD.heightIn - IN(CARD.margin + 24),
    h: IN(16),
    size: SIZES.coverMeta,
    color: COLORS.muted
  });

  // ── Una diapositiva por tarjeta ────────────────────────────
  deckModel.cards.forEach((card, index) => {
    const slide = pres.addSlide();
    slide.background = { color: COLORS.white };
    let y = IN(CARD.margin);

    if (card.image) {
      // Tamaño en pantalla a partir del aspecto real del PNG (sin suponer DPI)
      const aspect = pngWidth(card.image) / pngHeight(card.image);
      let h = IN(IMAGE_MAX_HEIGHT);
      let w = h * aspect;
      if (w > CONTENT_W) {
        w = CONTENT_W;
        h = w / aspect;
      }
      slide.addImage({
        data: `data:image/png;base64,${card.image.toString('base64')}`,
        x: CARD.widthIn / 2 - w / 2,
        y,
        w,
        h
      });
      y += h + IN(16);
    }

    // Término destacado
    const termH = Math.min(IN(96), Math.max(IN(30), CARD.heightIn - y - IN(60)));
    textBlock(slide, card.term, { y, h: termH, size: SIZES.term, bold: true });
    y += termH + IN(10);

    // Separador
    slide.addShape(pres.ShapeType.rect, {
      x: CARD.widthIn / 2 - IN(60),
      y,
      w: IN(120),
      h: IN(1),
      fill: { color: COLORS.line }
    });
    y += IN(12);

    // Definición (ocupa el resto de la tarjeta)
    textBlock(slide, card.definition, {
      y,
      h: Math.max(IN(40), CARD.heightIn - y - IN(CARD.margin + 16)),
      size: SIZES.definition,
      color: COLORS.muted
    });

    // Pie con el progreso
    textBlock(slide, `${index + 1} / ${total}`, {
      y: CARD.heightIn - IN(CARD.margin + 4),
      h: IN(12),
      size: SIZES.footer,
      color: COLORS.muted
    });
  });

  // Nota: stream() usa nodebuffer (jszip). write('buffer') pasa el tipo literal
  // 'buffer' a jszip y falla ("buffer is not supported by this platform").
  const out = await pres.stream();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

/** Ancho/alto en píxeles de un PNG (cabecera IHDR). */
const pngWidth = (png) => png.readUInt32BE(16);
const pngHeight = (png) => png.readUInt32BE(20);

module.exports = { buildDeckPptx };
