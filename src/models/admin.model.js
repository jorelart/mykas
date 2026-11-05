const { pool } = require('../config/database');

async function overview(requestedPage = 1) {
  const [[users]] = await pool.execute(`SELECT COUNT(*) total, COALESCE(SUM(is_verified=1),0) verified,
    COALESCE(SUM(is_suspended=1),0) suspended FROM users`);
  const pageSize = 25;
  const usersPages = Math.max(1, Math.ceil(Number(users.total) / pageSize));
  const usersPage = Math.min(Math.max(Number(requestedPage) || 1, 1), usersPages);
  const [[transactions]] = await pool.execute(`SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE deleted_at IS NULL`);
  const [recentUsers] = await pool.execute('SELECT id,name,email,is_verified,is_suspended,created_at FROM users ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?', [pageSize, (usersPage - 1) * pageSize]);
  const [recentTransactions] = await pool.execute(`SELECT t.*,u.name user_name,u.email user_email FROM transactions t
    JOIN users u ON u.id=t.user_id WHERE t.deleted_at IS NULL ORDER BY t.happened_on DESC,t.id DESC LIMIT 20`);
  return { users, usersPage, usersPages, transactions, recentUsers, recentTransactions };
}

async function setSuspended(userId, suspended) {
  const [result] = await pool.execute('UPDATE users SET is_suspended=? WHERE id=?', [suspended ? 1 : 0, userId]);
  return result.affectedRows > 0;
}

module.exports = { overview, setSuspended };
