const { pool } = require('../config/database');

async function createPending({ name, email, passwordHash, phone }) {
  const [result] = await pool.execute(
    'INSERT INTO users (name,email,password_hash,whatsapp_number,is_verified) VALUES (?,?,?,?,0)',
    [name, email, passwordHash, phone],
  );
  return result.insertId;
}

async function findByEmail(email) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE email=? LIMIT 1', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.execute('SELECT id,name,email,whatsapp_number,is_verified FROM users WHERE id=? LIMIT 1', [id]);
  return rows[0] || null;
}

async function findVerifiedByPhone(phone) {
  const [rows] = await pool.execute('SELECT id FROM users WHERE whatsapp_number=? AND is_verified=1 LIMIT 1', [phone]);
  return rows[0] || null;
}

async function activate(id) {
  await pool.execute('UPDATE users SET is_verified=1 WHERE id=?', [id]);
}

async function setPassword(id, passwordHash) {
  await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, id]);
}

module.exports = { activate, createPending, findByEmail, findById, findVerifiedByPhone, setPassword };
