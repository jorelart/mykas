const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const { csrfProtection } = require('./middleware/csrf');
const { requestLogger } = require('./middleware/request-logger');
const authRoutes = require('./routes/auth.routes');
const transactionRoutes = require('./routes/transaction.routes');
const reportRoutes = require('./routes/report.routes');
const webhookRoutes = require('./routes/webhook.routes');
const adminRoutes = require('./routes/admin.routes');
const { formatTransactionReference } = require('./utils/transaction-reference');

const app = express();
const MySQLStore = MySQLStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.use(requestLogger);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'static'), { maxAge: '1d' }));
app.use(session({
  name: 'mykas.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret',
  store: new MySQLStore({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'mykas', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mykas', schema: { tableName: 'sessions' },
  }),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(flash());
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.user = req.session.user || null;
  const queued = req.flash();
  res.locals.flashMessages = Object.entries(queued).flatMap(([type, messages]) => messages.map(message => ({ type, message })));
  res.locals.formatRupiah = value => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
  res.locals.formatDate = value => new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value));
  res.locals.currentPath = req.path;
  res.locals.publicUrl = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  res.locals.formatTransactionReference = formatTransactionReference;
  next();
});
app.use(csrfProtection);

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));
app.use(authRoutes);
app.use(transactionRoutes);
app.use(reportRoutes);
app.use(adminRoutes);
app.use('/api/webhook', webhookRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use((req, res) => res.status(404).render('error', { title: 'Halaman tidak ditemukan', message: 'Halaman yang Anda cari tidak tersedia.' }));
app.use((error, req, res, next) => {
  console.error(JSON.stringify({ level: 'error', component: 'http', method: req.method, path: req.path, message: error.message }));
  if (res.headersSent) return next(error);
  return res.status(500).render('error', { title: 'Terjadi kendala', message: 'Kami tidak dapat memproses permintaan ini. Coba lagi sebentar.' });
});

module.exports = app;
