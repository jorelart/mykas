const User = require('../models/user.model');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('info', 'Silakan masuk untuk melanjutkan.');
    return res.redirect('/login');
  }
  User.isSuspended(req.session.user.id).then(suspended => {
    if (!suspended) return next();
    res.locals.user = null;
    return req.session.destroy(() => res.status(403).render('error', { title: 'Akun ditangguhkan', message: 'Akun ini sedang ditangguhkan. Hubungi administrator MyKas untuk bantuan.' }));
  }).catch(next);
}

function requireAdmin(req, res, next) {
  const configured = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const signedInEmail = String(req.session.user?.email || '').trim().toLowerCase();
  if (!configured || !signedInEmail || signedInEmail !== configured) {
    return res.status(403).render('error', { title: 'Akses ditolak', message: 'Halaman ini hanya dapat dibuka oleh admin MyKas.' });
  }
  return next();
}

module.exports = { requireAdmin, requireAuth };
