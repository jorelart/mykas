const express = require('express');
const asyncRoute = require('../middleware/async-route');
const { requireAuth } = require('../middleware/auth');
const { requireWallet } = require('../middleware/require-wallet');
const Transaction = require('../controllers/transaction.controller');
const Wallet = require('../controllers/wallet.controller');

const router = express.Router();
router.get('/dompet', requireAuth, asyncRoute(Wallet.index));
router.post('/dompet', requireAuth, asyncRoute(Wallet.create));
router.post('/dompet/select', requireAuth, asyncRoute(Wallet.select));
router.post('/dompet/:id/hapus', requireAuth, asyncRoute(Wallet.remove));
router.get('/dashboard', requireAuth, asyncRoute(Transaction.dashboard));
router.get('/transaksi', requireAuth, requireWallet, asyncRoute(Transaction.list));
router.post('/transaksi/:id/dompet', requireAuth, requireWallet, asyncRoute(Transaction.assignWallet));
router.get('/transaksi/tambah', requireAuth, requireWallet, Transaction.addPage);
router.post('/transaksi/tambah', requireAuth, requireWallet, asyncRoute(Transaction.create));
router.get('/transaksi/:id/edit', requireAuth, requireWallet, asyncRoute(Transaction.editPage));
router.post('/transaksi/:id/edit', requireAuth, requireWallet, asyncRoute(Transaction.update));
router.get('/transaksi/:id', requireAuth, requireWallet, asyncRoute(Transaction.detail));
router.post('/transaksi/:id/hapus', requireAuth, requireWallet, asyncRoute(Transaction.remove));

module.exports = router;
