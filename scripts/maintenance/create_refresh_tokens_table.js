const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'servenow',
  port: process.env.DB_PORT || 3306,
};

async function createTable() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    console.log('Connected to database.');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        user_type ENUM(
          'customer',
          'store_owner',
          'admin',
          'standard_user',
          'staff',
          'vendor',
          'rider'
        ) NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP NULL,
        replaced_by_hash CHAR(64) NULL,
        device_id VARCHAR(128) DEFAULT NULL,
        INDEX idx_refresh_token_hash (token_hash),
        INDEX idx_refresh_user (user_id, user_type),
        INDEX idx_refresh_expires (expires_at)
      )
    `);
    console.log('Refresh tokens table created successfully.');
  } catch (error) {
    console.error('Error creating refresh_tokens table:', error);
  } finally {
    await connection.end();
  }
}

createTable();
