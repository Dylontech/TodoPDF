'use strict';

const { Router } = require('express');
const { register, login, logout, me } = require('../controllers/authController');

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', me);

module.exports = router;
