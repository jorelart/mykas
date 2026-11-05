const { pool } = require('../config/database');

async function list(connection, userId) {
  const [rows] = await (connection || pool).execute('SELECT id,name,balance FROM wallets WHERE user_id=? ORDER BY name,id', [userId]);
  return rows;
}

async function active(connection, phone, userId) {
  const [rows] = await connection.execute(`SELECT w.id,w.name,w.balance FROM user_sessions s
    JOIN wallets w ON w.id=s.active_wallet_id AND w.user_id=? WHERE s.phone_number=? LIMIT 1`, [userId, phone]);
  return rows[0] || null;
}

async function activeForUser(userId) {
  const [rows] = await pool.execute(`SELECT w.id,w.name,w.balance FROM users u
    JOIN user_sessions s ON s.phone_number=u.whatsapp_number
    JOIN wallets w ON w.id=s.active_wallet_id AND w.user_id=u.id WHERE u.id=? LIMIT 1`, [userId]);
  return rows[0] || null;
}

async function activeOrFirstForUser(userId) {
  let selected = await activeForUser(userId);
  if (selected) return selected;
  const wallets = await list(null, userId);
  if (!wallets.length) return null;
  await selectForUser(userId, wallets[0].id);
  selected = await activeForUser(userId);
  return selected;
}

async function create(connection, phone, userId, name) {
  const [result] = await connection.execute('INSERT INTO wallets(user_phone,user_id,name) VALUES(?,?,?)', [phone, userId, name]);
  return result.insertId;
}

async function createForUser(userId, name) {
  const [result] = await pool.execute('INSERT INTO wallets(user_phone,user_id,name) SELECT whatsapp_number,id,? FROM users WHERE id=?', [name, userId]);
  return result.insertId;
}

async function select(connection, phone, walletId) {
  await connection.execute(`INSERT INTO user_sessions(phone_number,active_wallet_id) VALUES(?,?)
    ON DUPLICATE KEY UPDATE active_wallet_id=VALUES(active_wallet_id),updated_at=CURRENT_TIMESTAMP`, [phone, walletId]);
}

async function selectForUser(userId, walletId) {
  const [result] = await pool.execute(`INSERT INTO user_sessions(phone_number,active_wallet_id)
    SELECT u.whatsapp_number,w.id FROM users u JOIN wallets w ON w.user_id=u.id
    WHERE u.id=? AND w.id=?
    ON DUPLICATE KEY UPDATE active_wallet_id=VALUES(active_wallet_id),updated_at=CURRENT_TIMESTAMP`, [userId, walletId]);
  return result.affectedRows > 0;
}

async function deleteForUser(userId, walletId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id,balance FROM wallets WHERE id=? AND user_id=? FOR UPDATE', [walletId, userId]);
    if (!rows.length || Number(rows[0].balance) !== 0) { await connection.rollback(); return false; }
    const [tx] = await connection.execute('SELECT COUNT(*) total FROM transactions WHERE wallet_id=?', [walletId]);
    if (Number(tx[0].total)) { await connection.rollback(); return false; }
    await connection.execute('DELETE FROM wallets WHERE id=?', [walletId]);
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

module.exports = { active, activeForUser, activeOrFirstForUser, create, createForUser, deleteForUser, list, select, selectForUser };
