'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const pLimit = require('p-limit');

const config = require('../config');
const db = require('../config/db');
const downloader = require('../services/downloaderService');
const { httpError } = require('../utils/errors');
const { sanitizeFilename } = require('../utils/files');

/**
 * Controlador del descargador de vídeos (solo usuarios autenticados).
 * Usa yt-dlp (YouTube, TikTok, X, Instagram, ...). El resultado se guarda
 * en el volumen /data/storage/<usuario>/downloads y se registra en la BD.
 */

// Límite de descargas simultáneas (protege red/disco/RAM).
const limit = pLimit(config.downloader.maxConcurrency);

/**
 * Mueve un archivo a su destino final; si el origen y el destino están en
 * sistemas de archivos distintos (EXDEV) copia y borra el origen.
 */
async function moveFile(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

/** POST /api/downloader/info — metadata del vídeo sin descargarlo. */
async function getInfo(req, res, next) {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') throw httpError(400, 'Falta la URL del vídeo.');
    const info = await downloader.getInfo(url);
    res.json({ info });
  } catch (err) {
    next(err);
  }
}

/** POST /api/downloader/download — descarga y guarda el archivo (vídeo, audio o playlist ZIP). */
async function download(req, res, next) {
  const userId = req.session.userId;
  try {
    const { url, kind, playlist } = req.body || {};
    if (!url || typeof url !== 'string') throw httpError(400, 'Falta la URL del vídeo.');
    const k = kind === 'audio' ? 'audio' : 'video';
    const isPlaylist = playlist === true || playlist === 'true';

    const dir = path.join(config.storage.storageDir, String(userId), 'downloads');
    await fsp.mkdir(dir, { recursive: true });

    // ── Playlist completa → ZIP ──────────────────────────────
    if (isPlaylist) {
      const result = await limit(() => downloader.downloadPlaylist(url, { kind: k }));
      try {
        const zipName = `${Date.now()}-playlist-${sanitizeFilename(result.title || 'playlist')}.zip`;
        const outPath = path.join(dir, zipName);
        await downloader.zipDirectory(result.tmpDir, outPath);
        const stat = await fsp.stat(outPath);

        const [id] = await db('downloads').insert({
          user_id: userId,
          platform: result.platform,
          url: String(url).slice(0, 2048),
          title: String(result.title || 'Playlist').slice(0, 512),
          kind: result.kind,
          ext: 'zip',
          output_path: outPath,
          size: stat.size
        });

        return res.status(201).json({
          id,
          title: result.title,
          name: zipName,
          kind: result.kind,
          ext: 'zip',
          platform: result.platform,
          size: stat.size,
          count: result.count,
          isPlaylist: true
        });
      } finally {
        await fsp.rm(result.tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    // ── Descarga simple (vídeo o audio) ─────────────────────
    const result = await limit(() => downloader.download(url, { kind: k }));
    try {
      const finalName = `${Date.now()}-${sanitizeFilename(result.title)}.${result.ext}`;
      const outPath = path.join(dir, finalName);
      await moveFile(result.filePath, outPath);

      const [id] = await db('downloads').insert({
        user_id: userId,
        platform: result.platform,
        url: String(url).slice(0, 2048),
        title: String(result.title).slice(0, 512),
        kind: result.kind,
        ext: result.ext,
        output_path: outPath,
        size: result.size
      });

      return res.status(201).json({
        id,
        title: result.title,
        name: finalName,
        kind: result.kind,
        ext: result.ext,
        platform: result.platform,
        size: result.size
      });
    } finally {
      // Limpia el directorio temporal de la descarga
      await fsp.rm(result.tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/downloader/history — historial del usuario. */
async function getHistory(req, res, next) {
  try {
    const rows = await db('downloads')
      .where({ user_id: req.session.userId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .select('id', 'platform', 'title', 'kind', 'ext', 'size', 'created_at');
    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/downloader/:id/download — descarga del archivo (solo el dueño). */
async function downloadFile(req, res, next) {
  try {
    const row = await db('downloads')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!row) throw httpError(404, 'Descarga no encontrada.');

    const stat = await fsp.stat(row.output_path).catch(() => null);
    if (!stat) throw httpError(404, 'El archivo ya no existe en el servidor.');

    const filename = `${sanitizeFilename(row.title)}.${row.ext}`;
    res.setHeader('Content-Type', downloader.mimeFor(row.ext));
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`
    );

    const stream = fs.createReadStream(row.output_path);
    stream.on('error', (err) => res.destroy(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { getInfo, download, getHistory, downloadFile };
