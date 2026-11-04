const Transaction = require('../models/transaction.model');
const { formatTransactionReference } = require('../utils/transaction-reference');

async function dashboard(req, res) {
  const data = await Transaction.dashboard(req.session.user.id);
  res.render('dashboard', {
    title: 'Dashboard', income: data.summary.income, expense: data.summary.expense,
    balance: Number(data.summary.income) - Number(data.summary.expense),
    monthCount: data.summary.count, count: data.total, recent: data.recent,
  });
}

function addPage(req, res) { return res.render('transaction-form', { title: 'Tambah transaksi' }); }

async function create(req, res) {
  const { kind, category } = req.body;
  const note = String(req.body.note || '').trim();
  const amount = Number(String(req.body.amount || '').replace(/,/g, ''));
  const happenedOn = String(req.body.happened_on || '');
  if (!['income', 'expense'].includes(kind) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999999
    || !category || category.trim().length > 80 || note.length > 240
    || !/^\d{4}-\d{2}-\d{2}$/.test(happenedOn) || Number.isNaN(Date.parse(`${happenedOn}T00:00:00Z`))) {
    req.flash('danger', 'Periksa kembali jenis, nominal, kategori, catatan, dan tanggal transaksi.');
    return res.redirect('/transaksi/tambah');
  }
  const id = await Transaction.create({ userId: req.session.user.id, kind, amount, category: category.trim(), note, happenedOn });
  req.flash('success', `Transaksi berhasil dicatat dengan ID ${formatTransactionReference(id)}.`);
  return res.redirect('/transaksi');
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
  res.render('transactions', { title: 'Transaksi', rows, kind, start: start || '', end: end || '' });
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

module.exports = { addPage, create, dashboard, detail, list, remove };
