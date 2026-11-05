const Wallet = require('../models/wallet.model');

function requireWallet(req, res, next) {
  Wallet.list(null, req.session.user.id).then(wallets => {
    if (wallets.length) return next();
    req.flash('warning', 'Buat dompet pertama Anda sebelum membuka transaksi atau laporan.');
    return res.redirect('/dashboard');
  }).catch(next);
}

module.exports = { requireWallet };
