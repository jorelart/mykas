const { pool } = require('../config/database');

async function claim(connection, messageId) {
  const [result] = await connection.execute('INSERT IGNORE INTO webhook_events (message_id,status) VALUES (?,?)', [messageId, 'ignored']);
  return result.affectedRows > 0;
}

async function markRecorded(connection, messageId) {
  await connection.execute('UPDATE webhook_events SET status=\'recorded\' WHERE message_id=?', [messageId]);
}

function getConnection() { return pool.getConnection(); }

module.exports = { claim, getConnection, markRecorded };
