function requireAuth(req, res, next) {
  if (req.session.user) return next();
  req.flash('info', 'Silakan masuk untuk melanjutkan.');
  return res.redirect('/login');
}

module.exports = { requireAuth };
