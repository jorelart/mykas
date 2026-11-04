const express = require('express');
const asyncRoute = require('../middleware/async-route');
const { requireAuth } = require('../middleware/auth');
const Transaction = require('../controllers/transaction.controller');

const router = express.Router();
router.get('/dashboard', requireAuth, asyncRoute(Transaction.dashboard));
router.get('/transaksi', requireAuth, asyncRoute(Transaction.list));
router.get('/transaksi/tambah', requireAuth, Transaction.addPage);
router.post('/transaksi/tambah', requireAuth, asyncRoute(Transaction.create));
router.get('/transaksi/:id', requireAuth, asyncRoute(Transaction.detail));
router.post('/transaksi/:id/hapus', requireAuth, asyncRoute(Transaction.remove));

module.exports = router;
