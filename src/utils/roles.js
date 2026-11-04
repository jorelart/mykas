function isAdminEmail(email) {
  const configured = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(configured && String(email || '').trim().toLowerCase() === configured);
}

module.exports = { isAdminEmail };
