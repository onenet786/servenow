const mysql = require('mysql2/promise');
require('dotenv').config();

async function addDateOfBirthColumn() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'servenow',
  };

  try {
    const connection = await mysql.createConnection(config);

    const [columns] = await connection.execute(
      "SHOW COLUMNS FROM users LIKE 'date_of_birth'"
    );

    if (columns.length > 0) {
      console.log('users.date_of_birth already exists.');
      await connection.end();
      return;
    }

    await connection.execute(
      "ALTER TABLE users ADD COLUMN date_of_birth DATE NULL AFTER last_name"
    );
    console.log('Added users.date_of_birth column.');

    await connection.end();
  } catch (error) {
    console.error('Error adding date_of_birth column:', error);
  }
}

addDateOfBirthColumn();
