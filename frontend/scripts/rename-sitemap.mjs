// ─────────────────────────────────────────────────────────────
// TodoPDF — Renombra sitemap-index.xml → sitemap.xml tras el build
// de Astro. La integración @astrojs/sitemap genera el índice con el
// nombre `sitemap-index.xml`; este paso sirve el sitemap en la ruta
// más habitual para SEO: /sitemap.xml.
// Si el archivo no existe (p.ej. build sin páginas) no rompe el build.
// ─────────────────────────────────────────────────────────────
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const from = join(dist, 'sitemap-index.xml');
const to = join(dist, 'sitemap.xml');

try {
  await rename(from, to);
  console.log('✅ sitemap.xml generado (renombrado desde sitemap-index.xml)');
} catch (err) {
  console.warn('⚠️  No se pudo generar sitemap.xml:', err?.code ?? err.message);
}
