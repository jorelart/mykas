function requireAuth(req, res, next) {
  if (req.session.user) return next();
  req.flash('info', 'Silakan masuk untuk melanjutkan.');
  return res.redirect('/login');
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
