const Admin = require('../models/admin.model');

async function dashboard(req, res) {
  const data = await Admin.overview();
  res.render('admin', { title: 'Admin', ...data });
}

module.exports = { dashboard };
