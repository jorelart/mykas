const express = require('express');
const asyncRoute = require('../middleware/async-route');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const Admin = require('../controllers/admin.controller');

const router = express.Router();
router.get('/admin', requireAuth, requireAdmin, asyncRoute(Admin.dashboard));
router.post('/admin/users/:id/suspension', requireAuth, requireAdmin, asyncRoute(Admin.setSuspended));
router.post('/admin/users/:id/reset-password', requireAuth, requireAdmin, asyncRoute(Admin.resetPassword));

module.exports = router;
