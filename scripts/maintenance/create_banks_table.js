const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'servenow',
    port: process.env.DB_PORT || 3306
};

async function createTable() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        console.log('Connected to database.');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS banks (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                account_number VARCHAR(50),
                bank_code VARCHAR(20),
                branch_name VARCHAR(100),
                account_title VARCHAR(100),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('Banks table created successfully.');
    } catch (error) {
        console.error('Error creating table:', error);
    } finally {
        await connection.end();
    }
}

createTable();
