'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const config = require('../config');
const db = require('../config/db');

/**
 * ─────────────────────────────────────────────────────────────
 * GET /api/diagnostics — estado del entorno de producción.
 *
 * Pensado para diagnóstico SIN acceso a la terminal: devuelve en
 * JSON si los binarios de conversión están presentes, si los
 * directorios de almacenamiento son escribibles por el usuario del
 * proceso, si los módulos nativos cargan y si la BD responde.
 * ─────────────────────────────────────────────────────────────
 */

/** Versión de un binario vía --version/-v (o si el binario existe). */
function binVersion(bin, args = ['--version']) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      const out = String(stdout || stderr || '').trim().split('\n')[0];
      if (err && !out) {
        return resolve({ ok: false, error: err.message.split('\n')[0] });
      }
      // Algunos binarios (ffmpeg, pdfinfo) emiten la versión por stderr o
      // salen con código != 0 pese a responder; si hay texto, es que existe.
      resolve({ ok: true, version: out || '(presente)' });
    });
  });
}

/** Comprueba escritura real (crear + borrar un archivo de prueba). */
async function checkWritable(dir) {
  const probe = path.join(dir, `.diag-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message.split('\n')[0] };
  }
}

/** Comprueba que un módulo Node carga (requisitos nativos: sharp, etc.). */
async function checkModule(name) {
  try {
    if (name === 'file-type') {
      const mod = await import('file-type');
      const fn =
        mod.fileTypeFromBuffer ||
        (mod.default && (mod.default.fileTypeFromBuffer || mod.default.fromBuffer));
      return { ok: true, detected: typeof fn === 'function' };
    }
    require(name);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message.split('\n')[0] };
  }
}

/** GET /api/diagnostics */
async function getDiagnostics(req, res, next) {
  try {
    const [gs, pdfinfo, soffice, ytdlp, python3, ffmpeg] = await Promise.all([
      binVersion('gs'),
      binVersion('pdfinfo', ['-v']),
      binVersion('soffice'),
      binVersion('yt-dlp'),
      binVersion('python3', ['--version']),
      binVersion('ffmpeg', ['-version'])
    ]);

    const [storageW, tempW] = await Promise.all([
      checkWritable(config.storage.storageDir),
      checkWritable(config.storage.tempDir)
    ]);

    const [fileType, sharp, pdfLib, pptxgenjs, archiver] = await Promise.all([
      checkModule('file-type'),
      checkModule('sharp'),
      checkModule('pdf-lib'),
      checkModule('pptxgenjs'),
      checkModule('archiver')
    ]);

    let dbOk = false;
    let dbError = null;
    try {
      await db.raw('SELECT 1');
      dbOk = true;
    } catch (err) {
      dbError = err.message.split('\n')[0];
    }

    res.json({
      ok: true,
      node: process.version,
      env: config.env,
      processUser: { uid: process.getuid(), gid: process.getgid() },
      session: { hasUserId: !!(req.session && req.session.userId) },
      binaries: { gs, pdfinfo, soffice, ytdlp, python3, ffmpeg },
      storage: { dir: config.storage.storageDir, writable: storageW },
      temp: { dir: config.storage.tempDir, writable: tempW },
      modules: { 'file-type': fileType, sharp, 'pdf-lib': pdfLib, pptxgenjs, archiver },
      db: { ok: dbOk, error: dbError }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDiagnostics };
