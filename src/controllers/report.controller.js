const Transaction = require('../models/transaction.model');

async function index(req, res) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const start = validDate(req.query.dari) || `${today.slice(0, 7)}-01`;
  const end = validDate(req.query.sampai) || today;
  if (start > end) {
    req.flash('warning', 'Rentang tanggal tidak valid.');
    return res.redirect('/laporan');
  }
  const report = await Transaction.report(req.session.user.id, start, end);
  return res.render('reports', { title: 'Laporan', ...report, start, end });
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : '';
}

module.exports = { index };
