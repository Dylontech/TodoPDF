// @ts-check
import { defineConfig } from 'astro/config';

/**
 * TodoPDF — Frontend estático.
 * En producción nginx sirve el build y proxya /api al backend.
 * En desarrollo (astro dev) se proxya /api al backend local (puerto 3000).
 */
export default defineConfig({
  output: 'static',
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:3000'
      }
    }
  }
});
