const Transaction = require('../models/transaction.model');
const Wallet = require('../models/wallet.model');
const { formatTransactionReference } = require('../utils/transaction-reference');

async function dashboard(req, res) {
  const data = await Transaction.dashboard(req.session.user.id);
  res.render('dashboard', {
    title: 'Dashboard', income: data.summary.income, expense: data.summary.expense,
    balance: Number(data.summary.income) - Number(data.summary.expense),
    monthCount: data.summary.count, count: data.total, recent: data.recent,
  });
}

function addPage(req, res) { return res.render('transaction-form', { title: 'Tambah transaksi', transaction: null, editing: false }); }

async function editPage(req, res) {
  const transaction = await Transaction.findById(req.session.user.id, req.params.id);
  if (!transaction) return res.status(404).render('error', { title: 'Transaksi tidak ditemukan', message: 'Transaksi ini tidak ditemukan di akun Anda.' });
  return res.render('transaction-form', { title: 'Edit transaksi', transaction, editing: true });
}

async function create(req, res) {
  const values = parseTransaction(req.body);
  if (!values) {
    req.flash('danger', 'Periksa kembali jenis, nominal, kategori, catatan, dan tanggal transaksi.');
    return res.redirect('/transaksi/tambah');
  }
  const id = await Transaction.create({ userId: req.session.user.id, ...values });
  req.flash('success', `Transaksi berhasil dicatat dengan ID ${formatTransactionReference(id)}.`);
  return res.redirect('/transaksi');
}

async function update(req, res) {
  const values = parseTransaction(req.body);
  if (!values) {
    req.flash('danger', 'Periksa kembali jenis, nominal, kategori, catatan, dan tanggal transaksi.');
    return res.redirect(`/transaksi/${encodeURIComponent(req.params.id)}/edit`);
  }
  const updated = await Transaction.update(req.session.user.id, req.params.id, values);
  if (!updated) return res.status(404).render('error', { title: 'Transaksi tidak ditemukan', message: 'Transaksi ini tidak ditemukan di akun Anda.' });
  req.flash('success', 'Perubahan transaksi berhasil disimpan.');
  return res.redirect(`/transaksi/${encodeURIComponent(req.params.id)}`);
}

async function detail(req, res) {
  const transaction = await Transaction.findById(req.session.user.id, req.params.id);
  if (!transaction) return res.status(404).render('error', { title: 'Transaksi tidak ditemukan', message: 'Transaksi ini tidak ditemukan di akun Anda.' });
  return res.render('transaction-detail', { title: 'Detail transaksi', transaction });
}

async function list(req, res) {
  const kind = ['income', 'expense'].includes(req.query.jenis) ? req.query.jenis : '';
  const start = validDate(req.query.dari), end = validDate(req.query.sampai);
  const rows = await Transaction.list(req.session.user.id, { kind, start, end });
  const wallets = await Wallet.list(null, req.session.user.id);
  res.render('transactions', { title: 'Transaksi', rows, wallets, kind, start: start || '', end: end || '' });
}

async function createWallet(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 60) {
    req.flash('danger', 'Nama dompet wajib diisi dan maksimal 60 karakter.');
    return res.redirect('/transaksi');
  }
  try {
    await Wallet.createForUser(req.session.user.id, name);
    req.flash('success', `Dompet “${name}” berhasil dibuat.`);
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    req.flash('warning', `Dompet “${name}” sudah ada.`);
  }
  return res.redirect('/transaksi');
}

async function assignWallet(req, res) {
  const walletId = Number(req.body.wallet_id);
  if (!Number.isSafeInteger(walletId) || walletId <= 0) {
    req.flash('danger', 'Pilih dompet yang valid.');
    return res.redirect('/transaksi');
  }
  const moved = await Transaction.assignToWallet(req.session.user.id, req.params.id, walletId);
  req.flash(moved ? 'success' : 'warning', moved ? 'Transaksi dipindahkan ke dompet. Saldo dompet sudah diperbarui.' : 'Transaksi atau dompet tidak ditemukan, atau transaksi sudah memiliki dompet.');
  return res.redirect('/transaksi');
}

async function remove(req, res) {
  const removed = await Transaction.remove(req.session.user.id, req.params.id);
  req.flash(removed ? 'success' : 'warning', removed ? 'Transaksi dihapus dari riwayat aktif.' : 'Transaksi tidak ditemukan atau sudah dihapus.');
  return res.redirect('/transaksi');
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : '';
}

function parseTransaction(body) {
  const kind = body.kind;
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const note = String(body.note || '').trim();
  const amount = Number(String(body.amount || '').replace(/,/g, ''));
  const happenedOn = String(body.happened_on || '');
  if (!['income', 'expense'].includes(kind) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999999
    || !category || category.length > 80 || note.length > 240
    || !/^\d{4}-\d{2}-\d{2}$/.test(happenedOn) || Number.isNaN(Date.parse(`${happenedOn}T00:00:00Z`))) return null;
  return { kind, amount, category, note, happenedOn };
}

module.exports = { addPage, assignWallet, create, createWallet, dashboard, detail, editPage, list, remove, update };
