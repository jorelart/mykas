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

module.exports = { active, create, createForUser, list, select };
