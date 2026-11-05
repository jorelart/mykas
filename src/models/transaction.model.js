const { pool } = require('../config/database');

async function dashboard(userId, walletId = null) {
  const [[summary]] = await pool.execute(`SELECT
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense,
    COUNT(*) count FROM transactions WHERE user_id=? AND wallet_id=? AND deleted_at IS NULL AND happened_on >= DATE_FORMAT(CURDATE(),'%Y-%m-01') AND happened_on < DATE_ADD(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 1 MONTH)`, [userId, walletId || 0]);
  const [recent] = await pool.execute('SELECT t.*,w.name wallet_name FROM transactions t LEFT JOIN wallets w ON w.id=t.wallet_id WHERE t.user_id=? AND t.wallet_id=? AND t.deleted_at IS NULL ORDER BY t.happened_on DESC,t.id DESC LIMIT 6', [userId, walletId || 0]);
  const [[total]] = await pool.execute('SELECT COUNT(*) count FROM transactions WHERE user_id=? AND wallet_id=? AND deleted_at IS NULL', [userId, walletId || 0]);
  return { summary, recent, total: total.count };
}

async function create({ userId, walletId = null, kind, amount, category, note, happenedOn, source = 'manual' }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO transactions (user_id,wallet_id,kind,amount,category,note,happened_on,source) VALUES (?,?,?,?,?,?,?,?)',
      [userId, walletId, kind, amount, category, note || null, happenedOn, source],
    );
    if (walletId) {
      const delta = kind === 'income' ? amount : -amount;
      await connection.execute('UPDATE wallets SET balance=balance+? WHERE id=? AND user_id=?', [delta, walletId, userId]);
    }
    await connection.commit();
    return result.insertId;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function update(userId, transactionId, { kind, amount, category, note, happenedOn }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT wallet_id,kind,amount FROM transactions WHERE id=? AND user_id=? AND deleted_at IS NULL FOR UPDATE', [transactionId, userId]);
    if (!rows.length) { await connection.rollback(); return false; }
    const old = rows[0];
    await connection.execute('UPDATE transactions SET kind=?,amount=?,category=?,note=?,happened_on=? WHERE id=? AND user_id=? AND deleted_at IS NULL', [kind, amount, category, note || null, happenedOn, transactionId, userId]);
    if (old.wallet_id) {
      const oldDelta = old.kind === 'income' ? Number(old.amount) : -Number(old.amount);
      const newDelta = kind === 'income' ? amount : -amount;
      await connection.execute('UPDATE wallets SET balance=balance+? WHERE id=?', [newDelta - oldDelta, old.wallet_id]);
    }
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function list(userId, { kind, start, end, limit = 250, walletId }) {
  let sql = 'SELECT t.*,w.name wallet_name FROM transactions t LEFT JOIN wallets w ON w.id=t.wallet_id WHERE t.user_id=? AND t.deleted_at IS NULL';
  const params = [userId];
  if (walletId !== undefined) { sql += ' AND t.wallet_id=?'; params.push(walletId); }
  if (kind) { sql += ' AND t.kind=?'; params.push(kind); }
  if (start) { sql += ' AND t.happened_on>=?'; params.push(start); }
  if (end) { sql += ' AND t.happened_on<=?'; params.push(end); }
  sql += ' ORDER BY t.happened_on DESC,t.id DESC LIMIT ?';
  params.push(limit);
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function remove(userId, transactionId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT wallet_id,kind,amount FROM transactions WHERE id=? AND user_id=? AND deleted_at IS NULL FOR UPDATE', [transactionId, userId]);
    if (!rows.length) { await connection.rollback(); return false; }
    await connection.execute('UPDATE transactions SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND deleted_at IS NULL', [transactionId, userId]);
    const tx = rows[0];
    if (tx.wallet_id) {
      const delta = tx.kind === 'income' ? -Number(tx.amount) : Number(tx.amount);
      await connection.execute('UPDATE wallets SET balance=balance+? WHERE id=?', [delta, tx.wallet_id]);
    }
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function findById(userId, transactionId) {
  const [rows] = await pool.execute('SELECT t.*,w.name wallet_name FROM transactions t LEFT JOIN wallets w ON w.id=t.wallet_id WHERE t.id=? AND t.user_id=? AND t.deleted_at IS NULL LIMIT 1', [transactionId, userId]);
  return rows[0] || null;
}

async function assignToWallet(userId, transactionId, walletId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [transactions] = await connection.execute('SELECT id,kind,amount FROM transactions WHERE id=? AND user_id=? AND wallet_id IS NULL AND deleted_at IS NULL FOR UPDATE', [transactionId, userId]);
    const [wallets] = await connection.execute('SELECT id FROM wallets WHERE id=? AND user_id=? FOR UPDATE', [walletId, userId]);
    if (!transactions.length || !wallets.length) { await connection.rollback(); return false; }
    const tx = transactions[0];
    const delta = tx.kind === 'income' ? Number(tx.amount) : -Number(tx.amount);
    await connection.execute('UPDATE transactions SET wallet_id=? WHERE id=? AND user_id=? AND wallet_id IS NULL', [walletId, transactionId, userId]);
    await connection.execute('UPDATE wallets SET balance=balance+? WHERE id=?', [delta, walletId]);
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function report(userId, start, end, walletId = null, kind = '') {
  let typeFilter = '';
  const params = [userId, walletId || 0, start, end];
  if (kind) { typeFilter = ' AND kind=?'; params.push(kind); }
  const [totals] = await pool.execute(`SELECT kind,COALESCE(SUM(amount),0) total FROM transactions WHERE user_id=? AND wallet_id=? AND deleted_at IS NULL AND happened_on BETWEEN ? AND ?${typeFilter} GROUP BY kind`, params);
  const summary = Object.fromEntries(totals.map(row => [row.kind, Number(row.total)]));
  const [categories] = await pool.execute(`SELECT category,kind,SUM(amount) total FROM transactions WHERE user_id=? AND wallet_id=? AND deleted_at IS NULL AND happened_on BETWEEN ? AND ?${typeFilter} GROUP BY category,kind ORDER BY total DESC`, params);
  const rows = await list(userId, { start, end, kind, limit: 500, walletId: walletId || 0 });
  return { income: summary.income || 0, expense: summary.expense || 0, categories, rows };
}

async function createFromWebhook({ connection, userId, walletId = null, kind, amount, category, note }) {
  if (connection) {
    const [result] = await connection.execute('INSERT INTO transactions (user_id,wallet_id,kind,amount,category,note,happened_on,source) VALUES (?,?,?,?,?,?,CURDATE(),\'whatsapp\')', [userId, walletId, kind, amount, category, note || null]);
    return result.insertId;
  }
  return create({ userId, kind, amount, category, note, happenedOn: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }), source: 'whatsapp' });
}

module.exports = { assignToWallet, create, createFromWebhook, dashboard, findById, list, remove, report, update };
