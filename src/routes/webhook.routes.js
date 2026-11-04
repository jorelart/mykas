const express = require('express');
const asyncRoute = require('../middleware/async-route');
const Webhook = require('../controllers/webhook.controller');

const router = express.Router();
router.post('/evolution/:event?', asyncRoute(Webhook.evolution));

module.exports = router;
