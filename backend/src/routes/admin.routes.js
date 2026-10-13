'use strict';

const { Router } = require('express');
const { requireAdmin } = require('../middleware/auth');
const { listUsers, getUserHistory, deleteHistory, deleteUserHistory, banUser, unbanUser } = require('../controllers/adminController');

const router = Router();

router.use(requireAdmin);
router.get('/users', listUsers);
router.get('/users/:userId/history', getUserHistory);
router.post('/users/:userId/ban', banUser);
router.post('/users/:userId/unban', unbanUser);
router.delete('/users/:userId/history', deleteUserHistory);
router.delete('/history/:table/:id', deleteHistory);

module.exports = router;