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

        try {
            await connection.execute(`
                ALTER TABLE stores 
                ADD COLUMN payment_term ENUM('Cash Only','Cash with Discount','Credit','Credit with Discount') DEFAULT NULL
            `);
            console.log('Added payment_term to stores table.');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('stores.payment_term already exists.');
            } else {
                throw err;
            }
        }

        try {
            await connection.execute(`
                ALTER TABLE products 
                ADD COLUMN cost_price DECIMAL(10, 2) NULL
            `);
            console.log('Added cost_price to products table.');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('products.cost_price already exists.');
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
