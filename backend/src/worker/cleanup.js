'use strict';

const config = require('../config');
const db = require('../config/db');
const { deleteExpired } = require('../services/historyLifecycleService');

const LOCK_NAME = 'todopdf-history-retention';
let timer;

async function runCleanup() {
  const [result] = await db.raw('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
  if (!result[0] || result[0].acquired !== 1) return;
  try {
    const summary = await deleteExpired();
    console.log(`[TodoPDF] Limpieza completada: ${summary.deleted} eliminados, ${summary.failed} fallidos.`);
  } finally {
    await db.raw('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
  }
}

async function main() {
  await db.migrate.latest();
  await runCleanup();
  timer = setInterval(() => runCleanup().catch((err) => console.error('[TodoPDF] Error de limpieza:', err)), config.retention.intervalMs);
  const shutdown = async () => {
    clearInterval(timer);
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(async (err) => {
  console.error('[TodoPDF] Error al iniciar cleanup:', err);
  await db.destroy();
  process.exit(1);
});