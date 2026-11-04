const express = require('express');
const asyncRoute = require('../middleware/async-route');
const { requireAuth } = require('../middleware/auth');
const Report = require('../controllers/report.controller');

const router = express.Router();
router.get('/laporan', requireAuth, asyncRoute(Report.index));

module.exports = router;
