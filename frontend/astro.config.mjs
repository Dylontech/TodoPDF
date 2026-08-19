// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * TodoPDF — Frontend estático.
 * En producción nginx sirve el build y proxya /api al backend.
 * En desarrollo (astro dev) se proxya /api al backend local (puerto 3000).
 */

// Páginas que NO deben indexarse (requieren sesión o son de autenticación).
const PRIVATE_PATHS = new Set([
  '/login',
  '/register',
  '/historial',
  '/descargar-videos',
  '/quitar-fondo',
  '/imagen-a-vectorial'
]);

export default defineConfig({
  // URL pública de producción (necesaria para el sitemap).
  site: 'https://todopdf.dylontech.com',
  output: 'static',
  integrations: [
    // Genera el sitemap automáticamente en cada build, excluyendo
    // las páginas privadas. El script de build lo renombra a sitemap.xml.
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/$/, '');
        return !PRIVATE_PATHS.has(path);
      }
    })
  ],
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:3000'
      }
    }
  }
});
