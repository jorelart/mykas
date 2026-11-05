const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const User = require('../models/user.model');
const Otp = require('../models/otp.model');
const { evolutionReady, sendWhatsApp } = require('../utils/evolution');
const { normalizePhone } = require('../utils/phone');
const { welcomeMessage } = require('../utils/whatsapp-bot');

function renderLogin(req, res) {
  if (req.session.user) return res.redirect('/dashboard');
  return res.render('auth', { mode: 'login', title: 'Masuk' });
}

function renderRegister(req, res) {
  if (req.session.user) return res.redirect('/dashboard');
  return res.render('auth', { mode: 'register', title: 'Buat akun' });
}

async function register(req, res) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = normalizePhone(req.body.whatsapp_number);
  const password = String(req.body.password || '');
  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 160 || phone.length < 10 || phone.length > 15 || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    req.flash('danger', 'Periksa nama, email, nomor WhatsApp, dan kata sandi (minimal 8 karakter).');
    return res.redirect('/register');
  }
  if (!evolutionReady()) {
    req.flash('danger', 'OTP belum dapat dikirim. Admin perlu mengatur koneksi Evolution API terlebih dahulu.');
    return res.redirect('/register');
  }
  try {
    const userId = await User.createPending({ name, email, passwordHash: await bcrypt.hash(password, 12), phone });
    req.session.pendingActivationUserId = userId;
    req.session.pendingActivationPhone = phone;
    try { await issueOtp(userId, 'activation'); req.flash('success', 'Kode aktivasi sudah dikirim ke WhatsApp Anda.'); }
    catch (error) { console.error(JSON.stringify({ component: 'otp', stage: 'send_failed', purpose: 'activation', message: error.message })); req.flash('warning', 'Akun sudah dibuat, tetapi OTP belum terkirim. Gunakan tombol kirim ulang sebentar lagi.'); }
    return res.redirect('/aktivasi');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') { req.flash('danger', 'Email atau nomor WhatsApp tersebut sudah terdaftar.'); return res.redirect('/register'); }
    throw error;
  }
}

function activationPage(req, res) {
  if (!req.session.pendingActivationUserId) return res.redirect('/register');
  return res.render('otp', { mode: 'activation', title: 'Aktivasi akun', whatsapp: req.session.pendingActivationPhone });
}

async function resendActivation(req, res) {
  const userId = req.session.pendingActivationUserId;
  if (!userId) return res.redirect('/register');
  try { await issueOtp(userId, 'activation'); req.flash('success', 'Kode aktivasi baru sudah dikirim ke WhatsApp Anda.'); }
  catch (error) {
    req.flash('warning', error.code === 'OTP_COOLDOWN' ? 'Tunggu satu menit sebelum meminta kode baru.' : 'OTP gagal dikirim. Periksa koneksi Evolution API.');
  }
  return res.redirect('/aktivasi');
}

async function activate(req, res) {
  const userId = req.session.pendingActivationUserId;
  if (!userId) return res.redirect('/register');
  if (!(await Otp.consume(userId, 'activation', req.body.code))) {
    req.flash('danger', 'Kode tidak valid, sudah kedaluwarsa, atau batas percobaan tercapai.');
    return res.redirect('/aktivasi');
  }
  const account = await User.findById(userId);
  if (!account) return res.redirect('/register');
  await User.activate(userId);
  try { await sendWhatsApp(account.whatsapp_number, welcomeMessage(account.name)); }
  catch (error) { console.error(JSON.stringify({ component: 'welcome-message', stage: 'send_failed', message: error.message })); }
  delete req.session.pendingActivationUserId;
  delete req.session.pendingActivationPhone;
  req.session.regenerate((error) => {
    if (error) return res.status(500).send('Gagal membuat sesi.');
    req.session.user = { id: account.id, name: account.name, email: account.email, whatsapp_number: account.whatsapp_number };
    if (String(process.env.ADMIN_EMAIL || '').trim().toLowerCase() === String(account.email).toLowerCase()) req.session.user.role = 'admin';
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.flash('success', `Selamat, ${account.name}! Pendaftaran berhasil dan akun WhatsApp Anda sudah aktif.`);
    return res.redirect('/dashboard');
  });
}

async function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const account = await User.findByEmail(email);
  if (!account || !(await bcrypt.compare(String(req.body.password || ''), account.password_hash))) {
    req.flash('danger', 'Email atau kata sandi tidak sesuai.');
    return res.redirect('/login');
  }
  if (account.is_suspended) {
    req.flash('danger', 'Akun Anda sedang ditangguhkan. Hubungi administrator MyKas.');
    return res.redirect('/login');
  }
  if (!account.is_verified) {
    req.session.pendingActivationUserId = account.id;
    req.session.pendingActivationPhone = account.whatsapp_number;
    req.flash('info', 'Verifikasi WhatsApp Anda sebelum masuk.');
    return res.redirect('/aktivasi');
  }
  req.session.regenerate((error) => {
    if (error) return res.status(500).send('Gagal membuat sesi.');
    req.session.user = { id: account.id, name: account.name, email: account.email };
    if (String(process.env.ADMIN_EMAIL || '').trim().toLowerCase() === String(account.email).toLowerCase()) req.session.user.role = 'admin';
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    return res.redirect('/dashboard');
  });
}

async function profilePage(req, res) {
  const account = await User.findById(req.session.user.id);
  if (!account) return res.redirect('/logout');
  return res.render('profile', { title: 'Profil', account });
}

async function updateProfile(req, res) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const current = await User.findById(req.session.user.id);
  if (!current) return res.redirect('/logout');
  const configuredAdmin = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 160) {
    req.flash('danger', 'Nama harus diisi dan email harus valid.');
    return res.redirect('/profil');
  }
  if (current.email.toLowerCase() === configuredAdmin && email !== current.email.toLowerCase()) {
    req.flash('warning', 'Email akun administrator tidak dapat diubah dari halaman profil.');
    return res.redirect('/profil');
  }
  if (email === configuredAdmin && current.email.toLowerCase() !== configuredAdmin) {
    req.flash('danger', 'Email administrator utama tidak dapat digunakan oleh akun lain.');
    return res.redirect('/profil');
  }
  if (email !== current.email.toLowerCase()) {
    const passwordRecord = await User.findByEmail(current.email.toLowerCase());
    if (!passwordRecord || !(await bcrypt.compare(String(req.body.current_password || ''), passwordRecord.password_hash))) {
      req.flash('danger', 'Masukkan kata sandi saat ini untuk mengubah email.');
      return res.redirect('/profil');
    }
  }
  try {
    await User.updateProfile(current.id, { name, email });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      req.flash('danger', 'Email tersebut sudah digunakan akun lain.');
      return res.redirect('/profil');
    }
    throw error;
  }
  req.session.user.name = name;
  req.session.user.email = email;
  req.flash('success', 'Profil berhasil diperbarui.');
  return res.redirect('/profil');
}

async function changePassword(req, res) {
  const currentPassword = String(req.body.current_password || '');
  const password = String(req.body.password || '');
  const confirmation = String(req.body.password_confirmation || '');
  const account = await User.findByEmail(String(req.session.user.email || '').toLowerCase());
  if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) {
    req.flash('danger', 'Kata sandi saat ini tidak sesuai.');
    return res.redirect('/profil');
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    req.flash('danger', 'Kata sandi baru harus terdiri dari 8 sampai 72 karakter.');
    return res.redirect('/profil');
  }
  if (password !== confirmation) {
    req.flash('danger', 'Konfirmasi kata sandi baru tidak cocok.');
    return res.redirect('/profil');
  }
  await User.setPassword(account.id, await bcrypt.hash(password, 12));
  req.flash('success', 'Kata sandi berhasil diperbarui.');
  return res.redirect('/profil');
}

function forgotPage(req, res) { return res.render('auth', { mode: 'forgot', title: 'Reset kata sandi' }); }

async function requestPasswordReset(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const account = await User.findByEmail(email);
  const target = account && account.is_verified ? account : null;
  req.session.resetUserId = target ? target.id : null;
  if (target && evolutionReady()) {
    try { await issueOtp(target.id, 'reset'); }
    catch (error) { console.error(JSON.stringify({ component: 'otp', stage: 'send_failed', purpose: 'reset', message: error.message })); }
  }
  req.flash('info', 'Jika email terdaftar, kode reset akan dikirim ke WhatsApp yang terhubung.');
  return res.redirect('/reset-password');
}

function resetPage(req, res) {
  if (!req.session.resetUserId) return res.render('auth', { mode: 'forgot', title: 'Reset kata sandi' });
  return res.render('otp', { mode: 'reset', title: 'Reset kata sandi' });
}

async function resendReset(req, res) {
  if (req.session.resetUserId && evolutionReady()) {
    try { await issueOtp(req.session.resetUserId, 'reset'); }
    catch (error) { if (error.code !== 'OTP_COOLDOWN') console.error(JSON.stringify({ component: 'otp', stage: 'send_failed', purpose: 'reset', message: error.message })); }
  }
  req.flash('info', 'Jika email terdaftar, kode reset akan dikirim ke WhatsApp yang terhubung.');
  return res.redirect('/reset-password');
}

async function resetPassword(req, res) {
  const userId = req.session.resetUserId;
  const password = String(req.body.password || '');
  if (!userId) { req.flash('info', 'Silakan mulai reset melalui email akun Anda.'); return res.redirect('/lupa-password'); }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) { req.flash('danger', 'Kata sandi baru harus terdiri dari minimal 8 karakter dan maksimal 72 byte.'); return res.redirect('/reset-password'); }
  if (!(await Otp.consume(userId, 'reset', req.body.code))) {
    req.flash('danger', 'Kode tidak valid, sudah kedaluwarsa, atau batas percobaan tercapai.');
    return res.redirect('/reset-password');
  }
  await User.setPassword(userId, await bcrypt.hash(password, 12));
  delete req.session.resetUserId;
  req.flash('success', 'Kata sandi berhasil diubah. Silakan masuk dengan kata sandi baru.');
  return res.redirect('/login');
}

function logout(req, res) { req.session.destroy(() => res.redirect('/login')); }

async function issueOtp(userId, purpose) {
  if (!evolutionReady()) throw new Error('Evolution API belum dikonfigurasi.');
  const elapsed = await Otp.secondsSinceLastSent(userId, purpose);
  if (elapsed !== null && elapsed < 60) {
    const error = new Error('Tunggu satu menit sebelum meminta OTP baru.'); error.code = 'OTP_COOLDOWN'; throw error;
  }
  const account = await User.findById(userId);
  if (!account) throw new Error('Akun tidak ditemukan.');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await Otp.replaceCode(userId, purpose, code);
  const label = purpose === 'activation' ? 'aktivasi akun' : 'reset kata sandi';
  const nextStep = purpose === 'reset' ? '\nMasukkan email Anda di halaman Lupa kata sandi MyKas, lalu gunakan kode ini pada formulir reset.' : '';
  await sendWhatsApp(account.whatsapp_number, `Kode ${label} MyKas Anda: *${code}*${nextStep}\nKode berlaku 5 menit dan hanya dapat digunakan sekali.`);
}

async function adminSendPasswordReset(userId) {
  const account = await User.findById(userId);
  if (!account || !account.is_verified) return false;
  await issueOtp(userId, 'reset');
  return true;
}

module.exports = {
  activate, activationPage, adminSendPasswordReset, changePassword, forgotPage, login, logout, profilePage, register, renderLogin, renderRegister,
  resendActivation, resendReset, requestPasswordReset, resetPage, resetPassword,
  updateProfile,
};
