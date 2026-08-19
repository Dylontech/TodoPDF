'use strict';

const fs = require('node:fs/promises');
const fsStream = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const archiver = require('archiver');

const config = require('../config');
const { httpError } = require('../utils/errors');

/**
 * ─────────────────────────────────────────────────────────────
 * Descargador de vídeos/audio con yt-dlp.
 * Soporta YouTube, TikTok, X/Twitter, Instagram, Facebook,
 * Vimeo, Twitch, SoundCloud, Dailymotion, Reddit, etc.
 *
 * Cada descarga se ejecuta en un directorio temporal aislado y el
 * archivo final se mueve al almacenamiento del usuario (en el
 * controlador). Solo se usa desde rutas protegidas por requireAuth.
 * ─────────────────────────────────────────────────────────────
 */

// Directorio base de las descargas temporales (se crea bajo el tempDir).
const DL_TMP = path.join(config.storage.tempDir, 'downloader');
fs.mkdir(DL_TMP, { recursive: true }).catch(() => {});

// Clientes alternativos de YouTube (anti-403): el cliente por defecto (web)
// genera URLs de stream que YouTube bloquea con 403 al descargar; web_embedded
// y android sí funcionan. Se prioriza web_embedded y se omite `default`.
const YT_EXTRACTOR_ARGS = 'youtube:player_client=web_embedded,android,tv,ios';

// Mapa de sufijos de host → plataforma legible.
const HOST_PLATFORM = [
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['youtube-nocookie.com', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['t.co', 'twitter'],
  ['instagram.com', 'instagram'],
  ['facebook.com', 'facebook'],
  ['fb.watch', 'facebook'],
  ['vimeo.com', 'vimeo'],
  ['twitch.tv', 'twitch'],
  ['soundcloud.com', 'soundcloud'],
  ['dailymotion.com', 'dailymotion'],
  ['reddit.com', 'reddit']
];

/** Normaliza la plataforma a partir del host de la URL. */
function platformFromHost(host) {
  const h = String(host || '').toLowerCase();
  for (const [suffix, name] of HOST_PLATFORM) {
    if (h === suffix || h.endsWith('.' + suffix)) return name;
  }
  return 'web';
}

/**
 * Valida la URL (protocolo http/https y dominio en la lista blanca)
 * y la devuelve normalizada. Lanza 400 si no es segura.
 */
function parseUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw httpError(400, 'URL no válida.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw httpError(400, 'Solo se permiten enlaces http(s).');
  }
  const host = u.hostname.toLowerCase();
  const allowed = config.downloader.allowedHosts;
  const ok = allowed.some((h) => host === h || host.endsWith('.' + h));
  if (!ok) throw httpError(400, `Dominio no permitido: ${host}`);
  return u;
}

/**
 * Ejecuta yt-dlp con un timeout anti-DoS.
 *
 * @param {string[]} args  Argumentos de yt-dlp.
 * @param {object} [opts]  { timeoutMs, captureOutput }
 *   captureOutput: true  → captura stdout (dump-json) en memoria.
 *   captureOutput: false → descarta stdout (descargas: progreso enorme).
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runYtdlp(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const capture = opts.captureOutput !== false;
    let child;
    try {
      child = spawn(config.downloader.ytdlpPath, args, {
        stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe']
      });
    } catch {
      return reject(httpError(500, 'No se pudo iniciar yt-dlp.'));
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    if (capture) child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));

    child.on('error', (err) =>
      finish(reject, httpError(500, `Error al ejecutar yt-dlp: ${err.message}`))
    );
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr
          .split('\n')
          .filter((l) => l.trim())
          .slice(-6)
          .join(' ')
          .slice(0, 400);
        return finish(reject, httpError(422, `yt-dlp no pudo procesar el enlace: ${detail}`));
      }
      finish(resolve, { stdout, stderr });
    });

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ya terminó */
      }
      finish(reject, httpError(504, 'La descarga excedió el tiempo límite.'));
    }, opts.timeoutMs || config.downloader.timeoutMs);
  });
}

/** Normaliza la plataforma desde extractor_key de yt-dlp (para /info). */
function normalizeExtractor(raw) {
  const key = String(raw || 'generic').toLowerCase().split(':')[0].trim();
  if (key === 'twitter' || key === 'x') return 'twitter';
  if (key === 'generic') return 'web';
  return key || 'web';
}

/** Título de una playlist/canal (--print). Devuelve null si falla. */
async function playlistTitle(url) {
  try {
    const { stdout } = await runYtdlp(
      ['--print', '%(playlist_title)s', '--flat-playlist', '--no-warnings', '--skip-download', '--extractor-args', YT_EXTRACTOR_ARGS, url],
      { captureOutput: true, timeoutMs: 30_000 }
    );
    return stdout.split('\n').map((s) => s.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

/**
 * Obtiene la metadata de un enlace sin descargarlo.
 * Detecta playlists/canales (varias entradas planas) y las devuelve con
 * su lista de vídeos; si es un vídeo único devuelve su metadata completa.
 *
 * @returns {Promise<object>}
 *   Vídeo:  { isPlaylist:false, id, title, thumbnail, duration, uploader, platform, webpageUrl }
 *   Playlist: { isPlaylist:true, id, title, count, platform, webpageUrl, entries[] }
 */
async function getInfo(url) {
  const target = parseUrl(url);
  const { stdout } = await runYtdlp(
    ['--dump-json', '--flat-playlist', '--no-warnings', '--skip-download', '--extractor-args', YT_EXTRACTOR_ARGS, target.href],
    { captureOutput: true }
  );

  const entries = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (entries.length === 0) throw httpError(422, 'No se pudo obtener la información del enlace.');

  const first = entries[0];

  // Una playlist/canal produce varias entradas planas (_type: 'url'); un
  // vídeo único se vuelca como un único objeto con _type 'video'.
  const isPlaylist = entries.length > 1 || first._type === 'url';

  if (isPlaylist) {
    const title = (await playlistTitle(target.href)) || 'Playlist';
    return {
      isPlaylist: true,
      id: first.playlist_id || first.id || null,
      title,
      count: entries.length,
      platform: normalizeExtractor(first.extractor_key),
      webpageUrl: target.href,
      // Vista previa de las primeras entradas (id, título, url)
      entries: entries.slice(0, 30).map((e) => ({
        id: e.id || null,
        title: e.title || 'Sin título',
        url: e.url || null
      }))
    };
  }

  return {
    isPlaylist: false,
    id: first.id || null,
    title: first.title || 'Sin título',
    thumbnail: first.thumbnail || null,
    duration: Number(first.duration || 0),
    uploader: first.uploader || first.channel || first.creator || null,
    webpageUrl: first.webpage_url || target.href,
    platform: normalizeExtractor(first.extractor_key)
  };
}

/**
 * Descarga un vídeo (MP4/MKV) o su audio (MP3) a un directorio temporal.
 *
 * @param {string} url
 * @param {object} [opts] { kind: 'video' | 'audio' }
 * @returns {Promise<object>}
 *   { filePath, tmpDir, title, ext, size, platform }
 *   El caller debe mover filePath a su destino y limpiar tmpDir.
 */
async function download(url, opts = {}) {
  const target = parseUrl(url);
  const kind = opts.kind === 'audio' ? 'audio' : 'video';

  // Directorio temporal aislado por descarga
  const tmpDir = await fs.mkdtemp(path.join(DL_TMP, 'dl-'));
  const outputTemplate = path.join(tmpDir, '%(title)s.%(ext)s');

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--no-mtime',
    '--extractor-args', YT_EXTRACTOR_ARGS,
    '-o', outputTemplate
  ];

  if (kind === 'audio') {
    // Extracción de audio y conversión a MP3 (requiere ffmpeg)
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    // Mejor calidad video+audio; remuxa a mp4 con fallback mkv/webm
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4/mkv/webm');
  }
  args.push(target.href);

  try {
    await runYtdlp(args, { timeoutMs: config.downloader.timeoutMs, captureOutput: false });

    // Tras la descarga queda un único archivo final (el de mayor tamaño)
    const entries = await fs.readdir(tmpDir);
    const files = [];
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const p = path.join(tmpDir, name);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.isFile()) files.push({ name, size: st.size });
    }
    files.sort((a, b) => b.size - a.size);

    const winner = files[0];
    if (!winner) throw httpError(422, 'yt-dlp terminó sin generar ningún archivo.');

    const filePath = path.join(tmpDir, winner.name);
    const ext = path.extname(winner.name).slice(1).toLowerCase() || (kind === 'audio' ? 'mp3' : 'mp4');
    const title = path.basename(winner.name, path.extname(winner.name));

    return {
      filePath,
      tmpDir,
      title: title || 'video',
      ext,
      size: winner.size,
      platform: platformFromHost(target.hostname),
      kind
    };
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** MIME de descarga según la extensión final. */
function mimeFor(ext) {
  const map = {
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    zip: 'application/zip'
  };
  return map[String(ext).toLowerCase()] || 'application/octet-stream';
}

/**
 * Descarga una playlist/canal COMPLETA (vídeo o audio) a un directorio
 * temporal. El caller debe comprimirlo (zipDirectory) y limpiar tmpDir.
 *
 * @returns {Promise<object>} { tmpDir, title, count, platform, kind }
 */
async function downloadPlaylist(url, opts = {}) {
  const target = parseUrl(url);
  const kind = opts.kind === 'audio' ? 'audio' : 'video';

  const tmpDir = await fs.mkdtemp(path.join(DL_TMP, 'pl-'));
  const outputTemplate = path.join(tmpDir, '%(playlist_index)s - %(title)s.%(ext)s');

  const args = [
    '--no-warnings',
    '--no-progress',
    '--no-mtime',
    '--extractor-args', YT_EXTRACTOR_ARGS,
    '-o', outputTemplate
  ];
  if (kind === 'audio') {
    // Extracción de audio y conversión a MP3 (requiere ffmpeg)
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    // Mejor calidad video+audio; remuxa a mp4 con fallback mkv/webm
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4/mkv/webm');
  }
  args.push(target.href);

  try {
    await runYtdlp(args, { timeoutMs: config.downloader.timeoutMs, captureOutput: false });

    const files = (await fs.readdir(tmpDir)).filter((n) => !n.startsWith('.'));
    if (files.length === 0) throw httpError(422, 'yt-dlp no generó ningún archivo.');
    const title = (await playlistTitle(target.href)) || 'Playlist';

    return {
      tmpDir,
      title,
      count: files.length,
      platform: platformFromHost(target.hostname),
      kind
    };
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** Comprime un directorio completo en un archivo ZIP (archiver). */
function zipDirectory(dir, destZip) {
  return new Promise((resolve, reject) => {
    const output = fsStream.createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    output.on('error', (err) => reject(err));
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    archive.directory(dir, false);
    archive.finalize();
  });
}

module.exports = { getInfo, download, downloadPlaylist, zipDirectory, parseUrl, mimeFor };
