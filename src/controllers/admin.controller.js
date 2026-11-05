const Admin = require('../models/admin.model');
const Auth = require('./auth.controller');

async function dashboard(req, res) {
  const requestedPage = Number(req.query.users_page || 1);
  const data = await Admin.overview(Number.isSafeInteger(requestedPage) ? requestedPage : 1);
  res.render('admin', { title: 'Admin', ...data });
}

async function setSuspended(req, res) {
  const userId = Number(req.params.id);
  const suspended = req.body.suspended === '1';
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    req.flash('danger', 'Pengguna tidak ditemukan.');
    return res.redirect('/admin');
  }
  if (userId === Number(req.session.user.id) && suspended) {
    req.flash('warning', 'Anda tidak dapat menangguhkan akun administrator yang sedang digunakan.');
    return res.redirect('/admin');
  }
  const updated = await Admin.setSuspended(userId, suspended);
  req.flash(updated ? 'success' : 'warning', updated
    ? (suspended ? 'Akun pengguna berhasil ditangguhkan.' : 'Akun pengguna berhasil diaktifkan kembali.')
    : 'Pengguna tidak ditemukan.');
  return res.redirect('/admin');
}

async function resetPassword(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    req.flash('danger', 'Pengguna tidak ditemukan.');
    return res.redirect('/admin');
  }
  try {
    const sent = await Auth.adminSendPasswordReset(userId);
    req.flash(sent ? 'success' : 'warning', sent
      ? 'Kode reset dikirim ke WhatsApp pengguna. Minta pengguna membuka menu Lupa kata sandi dan memasukkan kode tersebut.'
      : 'Pengguna belum terverifikasi atau tidak ditemukan.');
  } catch (error) {
    req.flash('warning', error.code === 'OTP_COOLDOWN'
      ? 'Kode reset baru saja dikirim. Tunggu sebentar sebelum mengirim ulang.'
      : 'Kode reset gagal dikirim. Periksa koneksi Evolution API.');
  }
  return res.redirect('/admin');
}

module.exports = { dashboard, resetPassword, setSuspended };
