'use strict';

const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { attachUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const convertRoutes = require('./routes/convert.routes');
const historyRoutes = require('./routes/history.routes');
const pdfToolsRoutes = require('./routes/pdfTools.routes');
const downloaderRoutes = require('./routes/downloader.routes');
const removeBgRoutes = require('./routes/removeBg.routes');
const vectorizeRoutes = require('./routes/vectorize.routes');
const inpaintRoutes = require('./routes/inpaint.routes');
const { getDiagnostics } = require('./controllers/diagnosticsController');

const app = express();

// Detrás de nginx (proxy): confía en el primer salto para rate-limit/cookies
app.set('trust proxy', 1);

// Cabeceras de seguridad básicas
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// JSON (los archivos se suben por multipart, no por JSON)
app.use(express.json({ limit: '1mb' }));

// ── Sesiones persistentes en MariaDB ─────────────────────────
const sessionStore = new MySQLStore({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  createDatabaseTable: true, // crea la tabla 'sessions' automáticamente
  schema: { tableName: 'sessions' },
  expiration: 7 * 24 * 60 * 60 * 1000 // 7 días
});

app.use(
  session({
    secret: config.session.secret,
    name: config.session.name,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: config.session.cookie
  })
);

// Adjunta req.user a partir de la sesión (si existe)
app.use(attachUser);

// ── Rate limiting (anti-abuso) ───────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30,                  // 30 intentos de login/registro
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo más tarde.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de conversión. Inténtalo más tarde.' }
});

const downloaderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas descargas. Inténtalo más tarde.' }
});

const removeBgLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de eliminación de fondo. Inténtalo más tarde.' }
});

const vectorizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de vectorización. Inténtalo más tarde.' }
});

const inpaintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de eliminación de objetos. Inténtalo más tarde.' }
});

// ── Rutas ────────────────────────────────────────────────────
// Salud simple para orquestadores/healthchecks. Se declara ANTES de los
// routers protegidos: los routers con requireAuth responderían 401 a
// cualquier /api/* (incluido /api/health) si este llegara después.
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Diagnóstico del entorno (binarios, permisos de escritura, módulos, BD).
// Sin auth a propósito: accesible desde el navegador sin terminal.
app.get('/api/diagnostics', getDiagnostics);

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api', uploadLimiter, convertRoutes);
app.use('/api', uploadLimiter, pdfToolsRoutes);
app.use('/api', downloaderLimiter, downloaderRoutes);
app.use('/api', removeBgLimiter, removeBgRoutes);
app.use('/api', vectorizeLimiter, vectorizeRoutes);
app.use('/api', inpaintLimiter, inpaintRoutes);
app.use('/api', historyRoutes);

// ── Errores ──────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
