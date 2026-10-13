'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadFiles } = require('../middleware/upload');
const { splitImageController } = require('../controllers/splitImageController');

const router = Router();

router.use(requireAuth);
router.post('/split-image', uploadFiles('files', 1), splitImageController);

module.exports = router;
