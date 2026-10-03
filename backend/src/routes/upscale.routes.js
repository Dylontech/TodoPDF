'use strict';

const { Router } = require('express');
const { uploadFiles } = require('../middleware/upload');
const { upscale } = require('../controllers/upscaleController');

const router = Router();

// Reescalar imagen es MIXTO (patrón convert, SIN requireAuth global):
//  - x2/x4 (sharp) → disponible para invitados, respuesta directa en RAM.
//  - x8/x16 (Real-ESRGAN IA) → solo con sesión; el controlador responde 401.
// El middleware de subida elige RAM (invitado) o disco (autenticado) solo.
router.post('/upscale', uploadFiles('files', 1), upscale);

module.exports = router;
