const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

async function updateSchema() {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT
        });

        console.log('Connected.');

        // Add verification_code column
        try {
            await connection.execute(`
                ALTER TABLE users 
                ADD COLUMN verification_code VARCHAR(6) AFTER user_type,
                ADD COLUMN verification_expires_at TIMESTAMP AFTER verification_code,
                ADD COLUMN is_verified BOOLEAN DEFAULT FALSE AFTER verification_expires_at
            `);
            console.log('Added verification columns to users table.');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('Columns already exist.');
            } else {
                throw err;
            }
        }

    } catch (error) {
        console.error('Error updating schema:', error);
    } finally {
        if (connection) await connection.end();
    }
}

updateSchema();
