'use strict';

/**
 * Configuración centralizada de TodoPDF.
 * Todas las variables de entorno se normalizan aquí para un único punto de ajuste.
 */
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config();

const config = {
  // ── Servidor ───────────────────────────────────────────────
  env: process.env.TODOPDF_NODE_ENV || 'development',
  port: Number(process.env.TODOPDF_PORT || 3000),
  corsOrigin: (process.env.TODOPDF_CORS_ORIGIN || 'http://localhost:8080')
    .split(',')
    .map((s) => s.trim()),

  // ── Sesiones de servidor ───────────────────────────────────
  session: {
    secret: process.env.TODOPDF_SESSION_SECRET || 'dev-only-change-me',
    name: 'todopdf.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // no accesible desde JS (anti-XSS)
      sameSite: 'lax',
      secure: false, // activar si se sirve tras TLS (reverse proxy)
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 días
    }
  },

  // ── Base de datos (MariaDB/MySQL) ──────────────────────────
  db: {
    host: process.env.TODOPDF_DB_HOST || 'localhost',
    port: Number(process.env.TODOPDF_DB_PORT || 3306),
    user: process.env.TODOPDF_DB_USER || 'todopdf',
    password: process.env.TODOPDF_DB_PASSWORD || 'todopdf_secret_password',
    database: process.env.TODOPDF_DB_NAME || 'todopdf'
  },

  // ── Límites de subida ──────────────────────────────────────
  limits: {
    // Invitados: procesamiento estricto en RAM, límite menor
    maxUploadGuest: Number(process.env.TODOPDF_MAX_UPLOAD_GUEST || 25 * 1024 * 1024),
    // Autenticados: archivos en disco, límite mayor
    maxUploadAuth: Number(process.env.TODOPDF_MAX_UPLOAD_AUTH || 100 * 1024 * 1024),
    // Conversiones simultáneas (protege la RAM del servidor)
    maxConcurrency: Number(process.env.TODOPDF_MAX_CONCURRENCY || 2),
    // Páginas máximas por PDF
    maxPages: Number(process.env.TODOPDF_MAX_PAGES || 100)
  },

  // ── Conversión (Ghostscript / sharp) ───────────────────────
  conversion: {
    gsTimeoutMs: Number(process.env.TODOPDF_GS_TIMEOUT_MS || 60_000),
    jpegQuality: Number(process.env.TODOPDF_JPEG_QUALITY || 85),
    imageDpi: Number(process.env.TODOPDF_IMAGE_DPI || 150)
  },

  // ── Conversión Office (LibreOffice headless) ───────────────
  office: {
    // Binario de LibreOffice (soffice). En producción lo instala el Dockerfile.
    sofficePath: process.env.TODOPDF_SOFFICE_PATH || 'soffice',
    // Tiempo máximo por conversión (el arranque en frío de LO es lento).
    timeoutMs: Number(process.env.TODOPDF_SOFFICE_TIMEOUT_MS || 120_000),
    // LibreOffice es pesado (~200-500 MB/instancia): una única conversión a la vez.
    maxConcurrency: Number(process.env.TODOPDF_OFFICE_MAX_CONCURRENCY || 1)
  },

  // ── Storage (usuarios autenticados) ────────────────────────
  storage: {
    // Directorio final donde se guardan los archivos convertidos
    storageDir: process.env.TODOPDF_STORAGE_DIR || '/data/storage',
    // Directorio temporal para los uploads autenticados (se limpia tras procesar)
    tempDir: process.env.TODOPDF_TEMP_DIR || '/data/tmp'
  }
};

// Garantizar que los directorios de almacenamiento existan
for (const dir of [config.storage.storageDir, config.storage.tempDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
