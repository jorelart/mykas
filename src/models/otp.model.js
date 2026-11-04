const crypto = require('node:crypto');
const { pool } = require('../config/database');

function digest(userId, purpose, code) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-only-change-this-secret')
    .update(`${userId}:${purpose}:${code}`).digest('hex');
}

async function secondsSinceLastSent(userId, purpose) {
  const [rows] = await pool.execute('SELECT TIMESTAMPDIFF(SECOND,last_sent_at,NOW()) elapsed FROM otp_codes WHERE user_id=? AND purpose=? LIMIT 1', [userId, purpose]);
  return rows.length ? rows[0].elapsed : null;
}

async function replaceCode(userId, purpose, code) {
  await pool.execute(`INSERT INTO otp_codes (user_id,purpose,code_hash,expires_at,attempts,last_sent_at)
    VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 5 MINUTE),0,NOW())
    ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),expires_at=VALUES(expires_at),attempts=0,last_sent_at=NOW()`,
  [userId, purpose, digest(userId, purpose, code)]);
}

async function consume(userId, purpose, value) {
  const code = String(value || '').trim();
  if (!/^\d{6}$/.test(code)) return false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT code_hash,attempts,(expires_at>NOW()) valid FROM otp_codes WHERE user_id=? AND purpose=? FOR UPDATE', [userId, purpose]);
    if (!rows.length || !rows[0].valid || rows[0].attempts >= 5) { await connection.commit(); return false; }
    const expected = Buffer.from(rows[0].code_hash, 'hex');
    const received = Buffer.from(digest(userId, purpose, code), 'hex');
    if (!crypto.timingSafeEqual(expected, received)) {
      await connection.execute('UPDATE otp_codes SET attempts=attempts+1 WHERE user_id=? AND purpose=?', [userId, purpose]);
      await connection.commit(); return false;
    }
    await connection.execute('DELETE FROM otp_codes WHERE user_id=? AND purpose=?', [userId, purpose]);
    await connection.commit(); return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

module.exports = { consume, digest, replaceCode, secondsSinceLastSent };
