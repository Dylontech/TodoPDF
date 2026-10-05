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
const robots = join(dist, 'robots.txt');

try {
  await rename(from, to);
  console.log('✅ sitemap.xml generado (renombrado desde sitemap-index.xml)');
} catch (err) {
  console.warn('⚠️  No se pudo generar sitemap.xml:', err?.code ?? err.message);
}

try {
  const { readFile, writeFile } = await import('node:fs/promises');
  const siteUrl = process.env.PUBLIC_SITE_URL || 'http://localhost:4321';
  const robotsContent = await readFile(robots, 'utf8');
  await writeFile(robots, robotsContent.replaceAll('__PUBLIC_SITE_URL__', siteUrl));
} catch (err) {
  console.warn('⚠️  No se pudo configurar robots.txt:', err?.code ?? err.message);
}
