const express = require('express');
const asyncRoute = require('../middleware/async-route');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const Admin = require('../controllers/admin.controller');

const router = express.Router();
router.get('/admin', requireAuth, requireAdmin, asyncRoute(Admin.dashboard));

module.exports = router;
