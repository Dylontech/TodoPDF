'use strict';

const { Router } = require('express');
const { register, login, loginWithGoogle, logout, me } = require('../controllers/authController');

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/google', loginWithGoogle);
router.post('/logout', logout);
router.get('/me', me);

module.exports = router;
