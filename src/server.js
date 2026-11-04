require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'kasirapi', password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kasirapi', waitForConnections: true,
  connectionLimit: 10, timezone: '+07:00', charset: 'utf8mb4', decimalNumbers: true,
});
const MySQLStore = MySQLStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'static'), { maxAge: '1d' }));
app.use(session({
  name: 'kasirapi.sid', secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret',
  store: new MySQLStore({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'kasirapi', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kasirapi', schema: { tableName: 'sessions' },
  }),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(flash());
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.user = req.session.user || null;
  const queued = req.flash();
  res.locals.flashMessages = Object.entries(queued).flatMap(([type, messages]) => messages.map(message => ({ type, message })));
  res.locals.formatRupiah = (value) => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
  res.locals.formatDate = (value) => new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value));
  res.locals.currentPath = req.path;
  res.locals.publicUrl = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  next();
});

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL, email VARCHAR(160) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, whatsapp_number VARCHAR(24) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL, kind ENUM('income','expense') NOT NULL,
    amount DECIMAL(14,2) NOT NULL, category VARCHAR(80) NOT NULL, note VARCHAR(240) NULL,
    happened_on DATE NOT NULL, source ENUM('manual','whatsapp') NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tx_user_date (user_id,happened_on),
    CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(180) NOT NULL UNIQUE, status VARCHAR(24) NOT NULL DEFAULT 'ignored',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAuth = (req, res, next) => req.session.user ? next() : (req.flash('info', 'Silakan masuk untuk melanjutkan.'), res.redirect('/login'));
app.use((req, res, next) => {
  if (req.method === 'GET' || req.path === '/api/webhook/evolution') return next();
  const sent = req.body && req.body._csrf;
  if (!sent || !req.session.csrfToken || Buffer.byteLength(String(sent)) !== Buffer.byteLength(req.session.csrfToken) || !crypto.timingSafeEqual(Buffer.from(String(sent)), Buffer.from(req.session.csrfToken))) {
    return res.status(403).render('error', { title: 'Permintaan tidak valid', message: 'Muat ulang halaman dan coba lagi.' });
  }
  next();
});

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));
app.route('/register').get((req, res) => req.session.user ? res.redirect('/dashboard') : res.render('auth', { mode: 'register', title: 'Buat akun' }))
  .post(asyncRoute(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = normalizePhone(req.body.whatsapp_number);
    const password = String(req.body.password || '');
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 160 || !phone || password.length < 8) {
      req.flash('danger', 'Periksa nama, email, nomor WhatsApp, dan kata sandi (minimal 8 karakter).'); return res.redirect('/register');
    }
    try {
      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.execute('INSERT INTO users (name,email,password_hash,whatsapp_number) VALUES (?,?,?,?)', [name, email, hash, phone]);
      req.session.regenerate((err) => { if (err) return res.status(500).send('Gagal membuat sesi.'); req.session.user = { id: result.insertId, name, email }; req.session.csrfToken = crypto.randomBytes(32).toString('hex'); res.redirect('/dashboard'); });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') { req.flash('danger', 'Email atau nomor WhatsApp tersebut sudah terdaftar.'); return res.redirect('/register'); }
      throw err;
    }
  }));

app.route('/login').get((req, res) => req.session.user ? res.redirect('/dashboard') : res.render('auth', { mode: 'login', title: 'Masuk' }))
  .post(asyncRoute(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const [rows] = await pool.execute('SELECT id,name,email,password_hash FROM users WHERE email=? LIMIT 1', [email]);
    if (!rows.length || !(await bcrypt.compare(String(req.body.password || ''), rows[0].password_hash))) {
      req.flash('danger', 'Email atau kata sandi tidak sesuai.'); return res.redirect('/login');
    }
    const account = rows[0];
    req.session.regenerate((err) => { if (err) return res.status(500).send('Gagal membuat sesi.'); req.session.user = { id: account.id, name: account.name, email: account.email }; req.session.csrfToken = crypto.randomBytes(32).toString('hex'); res.redirect('/dashboard'); });
  }));
app.post('/logout', requireAuth, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/dashboard', requireAuth, asyncRoute(async (req, res) => {
  const [[sum]] = await pool.execute(`SELECT
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense,
    COUNT(*) count FROM transactions WHERE user_id=? AND happened_on >= DATE_FORMAT(CURDATE(),'%Y-%m-01') AND happened_on < DATE_ADD(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 1 MONTH)`, [req.session.user.id]);
  const [recent] = await pool.execute('SELECT * FROM transactions WHERE user_id=? ORDER BY happened_on DESC,id DESC LIMIT 6', [req.session.user.id]);
  const [[total]] = await pool.execute('SELECT COUNT(*) count FROM transactions WHERE user_id=?', [req.session.user.id]);
  res.render('dashboard', { title: 'Dashboard', income: sum.income, expense: sum.expense, balance: Number(sum.income)-Number(sum.expense), monthCount: sum.count, count: total.count, recent });
}));

app.route('/transaksi/tambah').get(requireAuth, (req, res) => res.render('transaction-form', { title: 'Tambah transaksi' }))
  .post(requireAuth, asyncRoute(async (req, res) => {
    const { kind, category, note } = req.body;
    const amount = Number(String(req.body.amount || '').replace(/,/g, ''));
    const happenedOn = String(req.body.happened_on || '');
    if (!['income','expense'].includes(kind) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999999 || !category || category.trim().length > 80 || (note || '').length > 240 || !/^\d{4}-\d{2}-\d{2}$/.test(happenedOn) || Number.isNaN(Date.parse(`${happenedOn}T00:00:00Z`))) {
      req.flash('danger', 'Periksa kembali jenis, nominal, kategori, catatan, dan tanggal transaksi.'); return res.redirect('/transaksi/tambah');
    }
    await pool.execute('INSERT INTO transactions (user_id,kind,amount,category,note,happened_on) VALUES (?,?,?,?,?,?)', [req.session.user.id, kind, amount, category.trim(), note.trim() || null, happenedOn]);
    req.flash('success', 'Transaksi berhasil dicatat.'); res.redirect('/transaksi');
  }));

app.get('/transaksi', requireAuth, asyncRoute(async (req, res) => {
  const kind = ['income','expense'].includes(req.query.jenis) ? req.query.jenis : '';
  const start = validDate(req.query.dari), end = validDate(req.query.sampai);
  let sql = 'SELECT * FROM transactions WHERE user_id=?', params = [req.session.user.id];
  if (kind) { sql += ' AND kind=?'; params.push(kind); }
  if (start) { sql += ' AND happened_on>=?'; params.push(start); }
  if (end) { sql += ' AND happened_on<=?'; params.push(end); }
  sql += ' ORDER BY happened_on DESC,id DESC LIMIT 250';
  const [rows] = await pool.execute(sql, params);
  res.render('transactions', { title: 'Transaksi', rows, kind, start: start || '', end: end || '' });
}));
app.post('/transaksi/:id/hapus', requireAuth, asyncRoute(async (req, res) => {
  await pool.execute('DELETE FROM transactions WHERE id=? AND user_id=?', [req.params.id, req.session.user.id]);
  req.flash('success', 'Transaksi berhasil dihapus.'); res.redirect('/transaksi');
}));

app.get('/laporan', requireAuth, asyncRoute(async (req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const start = validDate(req.query.dari) || `${today.slice(0,7)}-01`;
  const end = validDate(req.query.sampai) || today;
  if (start > end) { req.flash('warning', 'Rentang tanggal tidak valid.'); return res.redirect('/laporan'); }
  const [totals] = await pool.execute('SELECT kind,COALESCE(SUM(amount),0) total FROM transactions WHERE user_id=? AND happened_on BETWEEN ? AND ? GROUP BY kind', [req.session.user.id,start,end]);
  const summary = Object.fromEntries(totals.map(row => [row.kind, Number(row.total)]));
  const [categories] = await pool.execute('SELECT category,kind,SUM(amount) total FROM transactions WHERE user_id=? AND happened_on BETWEEN ? AND ? GROUP BY category,kind ORDER BY total DESC', [req.session.user.id,start,end]);
  const [rows] = await pool.execute('SELECT * FROM transactions WHERE user_id=? AND happened_on BETWEEN ? AND ? ORDER BY happened_on DESC,id DESC LIMIT 500', [req.session.user.id,start,end]);
  res.render('reports', { title: 'Laporan', rows, categories, start, end, income: summary.income || 0, expense: summary.expense || 0 });
}));

app.post('/api/webhook/evolution', asyncRoute(async (req, res) => {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'webhook_not_configured' });
  const supplied = req.get('x-webhook-secret') || req.query.secret || '';
  if (supplied.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return res.status(401).json({ error: 'unauthorized' });
  const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body;
  const key = data?.key || {};
  const messageId = String(key.id || data?.id || '');
  if (!messageId) return res.json({ status: 'ignored', reason: 'missing_message_id' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [insert] = await connection.execute('INSERT IGNORE INTO webhook_events (message_id,status) VALUES (?,?)', [messageId, 'ignored']);
    if (!insert.affectedRows) { await connection.rollback(); return res.json({ status: 'duplicate' }); }
    const parsed = parseTransactionMessage(extractMessageText(data));
    const phone = normalizePhone(String(key.remoteJid || data?.remoteJid || '').split('@')[0]);
    if (key.fromMe || !parsed) { await connection.commit(); return res.json({ status: 'ignored' }); }
    const [users] = await connection.execute('SELECT id FROM users WHERE whatsapp_number=? LIMIT 1', [phone]);
    if (!users.length) { await connection.commit(); return res.json({ status: 'unmatched_sender' }); }
    await connection.execute('INSERT INTO transactions (user_id,kind,amount,category,note,happened_on,source) VALUES (?,?,?,?,?,CURDATE(),\'whatsapp\')', [users[0].id, parsed.kind, parsed.amount, 'WhatsApp', parsed.note || 'Dicatat melalui WhatsApp']);
    await connection.execute('UPDATE webhook_events SET status=\'recorded\' WHERE message_id=?', [messageId]);
    await connection.commit(); return res.json({ status: 'recorded' });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use((req, res) => res.status(404).render('error', { title: 'Halaman tidak ditemukan', message: 'Halaman yang Anda cari tidak tersedia.' }));
app.use((error, req, res, next) => { console.error(error); if (res.headersSent) return next(error); res.status(500).render('error', { title: 'Terjadi kendala', message: 'Kami tidak dapat memproses permintaan ini. Coba lagi sebentar.' }); });

function normalizePhone(value) { let digits = String(value || '').replace(/\D/g, ''); if (digits.startsWith('0')) digits = `62${digits.slice(1)}`; return digits; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : ''; }
function extractMessageText(data) {
  const msg = data?.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || data?.text || '';
}
function parseTransactionMessage(text) {
  const match = String(text || '').match(/^\s*(masuk|pemasukan|keluar|pengeluaran)\s+([\d.,]+)(?:\s+(.+))?\s*$/i);
  if (!match) return null;
  const amount = Number(match[2].replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999999) return null;
  return { kind: /^(masuk|pemasukan)$/i.test(match[1]) ? 'income' : 'expense', amount, note: (match[3] || '').trim().slice(0, 240) };
}

async function start() {
  for (let attempt = 1; ; attempt += 1) {
    try { await pool.query('SELECT 1'); for (const statement of schema) await pool.query(statement); break; }
    catch (error) { if (attempt >= 30) throw error; console.log(`Menunggu MySQL (${attempt}/30)...`); await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  app.listen(port, '0.0.0.0', () => console.log(`Kasirapi berjalan di port ${port}`));
}
if (require.main === module) start().catch(error => { console.error('Gagal memulai aplikasi:', error); process.exit(1); });
module.exports = { app, parseTransactionMessage, normalizePhone };
