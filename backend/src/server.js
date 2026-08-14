'use strict';

const app = require('./app');
const config = require('./config');
const db = require('./config/db');

/**
 * Punto de entrada del backend.
 * Ejecuta las migraciones pendientes y arranca el servidor HTTP.
 */
async function main() {
  try {
    // Migraciones automáticas al arrancar (conveniente para el MVP)
    await db.migrate.latest();
    console.log('[TodoPDF] Migraciones aplicadas.');

    const server = app.listen(config.port, () => {
      console.log(`[TodoPDF] API escuchando en http://localhost:${config.port} (${config.env})`);
    });

    // Apagado limpio: cierra conexiones y el pool de Knex
    const shutdown = async (signal) => {
      console.log(`[TodoPDF] Recibido ${signal}, cerrando servidor...`);
      server.close(async () => {
        await db.destroy().catch(() => {});
        process.exit(0);
      });
      // Fuerza la salida si el cierre se alarga
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[TodoPDF] Error al iniciar:', err);
    process.exit(1);
  }
}

main();
