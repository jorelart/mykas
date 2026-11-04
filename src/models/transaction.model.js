const { pool } = require('../config/database');

async function dashboard(userId) {
  const [[summary]] = await pool.execute(`SELECT
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense,
    COUNT(*) count FROM transactions WHERE user_id=? AND happened_on >= DATE_FORMAT(CURDATE(),'%Y-%m-01') AND happened_on < DATE_ADD(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 1 MONTH)`, [userId]);
  const [recent] = await pool.execute('SELECT * FROM transactions WHERE user_id=? ORDER BY happened_on DESC,id DESC LIMIT 6', [userId]);
  const [[total]] = await pool.execute('SELECT COUNT(*) count FROM transactions WHERE user_id=?', [userId]);
  return { summary, recent, total: total.count };
}

async function create({ userId, kind, amount, category, note, happenedOn, source = 'manual' }) {
  const [result] = await pool.execute(
    'INSERT INTO transactions (user_id,kind,amount,category,note,happened_on,source) VALUES (?,?,?,?,?,?,?)',
    [userId, kind, amount, category, note || null, happenedOn, source],
  );
  return result.insertId;
}

async function list(userId, { kind, start, end, limit = 250 }) {
  let sql = 'SELECT * FROM transactions WHERE user_id=?';
  const params = [userId];
  if (kind) { sql += ' AND kind=?'; params.push(kind); }
  if (start) { sql += ' AND happened_on>=?'; params.push(start); }
  if (end) { sql += ' AND happened_on<=?'; params.push(end); }
  sql += ' ORDER BY happened_on DESC,id DESC LIMIT ?';
  params.push(limit);
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function remove(userId, transactionId) {
  const [result] = await pool.execute('DELETE FROM transactions WHERE id=? AND user_id=?', [transactionId, userId]);
  return result.affectedRows > 0;
}

async function findById(userId, transactionId) {
  const [rows] = await pool.execute('SELECT * FROM transactions WHERE id=? AND user_id=? LIMIT 1', [transactionId, userId]);
  return rows[0] || null;
}

async function report(userId, start, end) {
  const [totals] = await pool.execute('SELECT kind,COALESCE(SUM(amount),0) total FROM transactions WHERE user_id=? AND happened_on BETWEEN ? AND ? GROUP BY kind', [userId, start, end]);
  const summary = Object.fromEntries(totals.map(row => [row.kind, Number(row.total)]));
  const [categories] = await pool.execute('SELECT category,kind,SUM(amount) total FROM transactions WHERE user_id=? AND happened_on BETWEEN ? AND ? GROUP BY category,kind ORDER BY total DESC', [userId, start, end]);
  const rows = await list(userId, { start, end, limit: 500 });
  return { income: summary.income || 0, expense: summary.expense || 0, categories, rows };
}

async function createFromWebhook({ connection, userId, kind, amount, category, note }) {
  if (connection) {
    const [result] = await connection.execute('INSERT INTO transactions (user_id,kind,amount,category,note,happened_on,source) VALUES (?,?,?,?,?,CURDATE(),\'whatsapp\')', [userId, kind, amount, category, note || null]);
    return result.insertId;
  }
  return create({ userId, kind, amount, category, note, happenedOn: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }), source: 'whatsapp' });
}

module.exports = { create, createFromWebhook, dashboard, findById, list, remove, report };
