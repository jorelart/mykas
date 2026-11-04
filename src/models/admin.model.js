const { pool } = require('../config/database');

async function overview() {
  const [[users]] = await pool.execute(`SELECT COUNT(*) total, COALESCE(SUM(is_verified=1),0) verified FROM users`);
  const [[transactions]] = await pool.execute(`SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE deleted_at IS NULL`);
  const [recentUsers] = await pool.execute('SELECT id,name,email,is_verified,created_at FROM users ORDER BY created_at DESC,id DESC LIMIT 20');
  const [recentTransactions] = await pool.execute(`SELECT t.*,u.name user_name,u.email user_email FROM transactions t
    JOIN users u ON u.id=t.user_id WHERE t.deleted_at IS NULL ORDER BY t.happened_on DESC,t.id DESC LIMIT 20`);
  return { users, transactions, recentUsers, recentTransactions };
}

module.exports = { overview };
