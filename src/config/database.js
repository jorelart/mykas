const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'mykas',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mykas',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+07:00',
  charset: 'utf8mb4',
  decimalNumbers: true,
});

const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL, email VARCHAR(160) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, whatsapp_number VARCHAR(24) NOT NULL UNIQUE,
    is_verified TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL, kind ENUM('income','expense') NOT NULL,
    amount DECIMAL(14,2) NOT NULL, category VARCHAR(80) NOT NULL, note VARCHAR(240) NULL,
    happened_on DATE NOT NULL, source ENUM('manual','whatsapp') NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tx_user_date (user_id,happened_on),
    CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(180) NOT NULL UNIQUE, status VARCHAR(24) NOT NULL DEFAULT 'ignored',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS otp_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL, purpose ENUM('activation','reset') NOT NULL,
    code_hash CHAR(64) NOT NULL, expires_at DATETIME NOT NULL, attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_sent_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_otp_user_purpose(user_id,purpose),
    CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function initializeDatabase() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      for (const statement of schema) await pool.query(statement);
      try { await pool.query('ALTER TABLE users ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 1'); }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      console.log(`Menunggu MySQL (${attempt}/30)...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

module.exports = { pool, initializeDatabase };
