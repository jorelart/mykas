const crypto = require('node:crypto');

function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.path.startsWith('/api/webhook/evolution')) return next();
  const sent = req.body && req.body._csrf;
  const expected = req.session.csrfToken;
  if (!sent || !expected || Buffer.byteLength(String(sent)) !== Buffer.byteLength(expected)
    || !crypto.timingSafeEqual(Buffer.from(String(sent)), Buffer.from(expected))) {
    return res.status(403).render('error', { title: 'Permintaan tidak valid', message: 'Muat ulang halaman dan coba lagi.' });
  }
  return next();
}

module.exports = { csrfProtection };
