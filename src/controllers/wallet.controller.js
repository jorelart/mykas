const Wallet = require('../models/wallet.model');

async function index(req, res) {
  const wallets = await Wallet.list(null, req.session.user.id);
  const activeWallet = await Wallet.activeOrFirstForUser(req.session.user.id);
  return res.render('wallets', { title: 'Dompet', wallets, activeWallet });
}

async function create(req, res) {
  const returnTo = req.body.return_to === '/dashboard' ? '/dashboard' : '/dompet';
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 60) {
    req.flash('danger', 'Nama dompet wajib diisi dan maksimal 60 karakter.');
    return res.redirect(returnTo);
  }
  else {
    try {
      const id = await Wallet.createForUser(req.session.user.id, name);
      if (!(await Wallet.activeForUser(req.session.user.id))) await Wallet.selectForUser(req.session.user.id, id);
      req.flash('success', `Dompet “${name}” berhasil dibuat.`);
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      req.flash('warning', `Dompet “${name}” sudah ada.`);
    }
  }
  return res.redirect(returnTo);
}

async function select(req, res) {
  const id = Number(req.body.wallet_id);
  const selected = Number.isSafeInteger(id) && id > 0 && await Wallet.selectForUser(req.session.user.id, id);
  req.flash(selected ? 'success' : 'warning', selected ? 'Dompet aktif berhasil diganti.' : 'Dompet tidak ditemukan.');
  const returnTo = ['/dashboard', '/transaksi', '/laporan', '/dompet'].includes(req.body.return_to) ? req.body.return_to : '/dompet';
  return res.redirect(returnTo);
}

async function remove(req, res) {
  const id = Number(req.params.id);
  const removed = Number.isSafeInteger(id) && id > 0 && await Wallet.deleteForUser(req.session.user.id, id);
  req.flash(removed ? 'success' : 'warning', removed ? 'Dompet berhasil dihapus.' : 'Dompet harus bersaldo Rp 0 dan tidak memiliki riwayat transaksi agar dapat dihapus.');
  return res.redirect('/dompet');
}

module.exports = { create, index, remove, select };
