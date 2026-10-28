const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        // Check wallets for the rider
        const [wallets] = await connection.query(`
            SELECT w.* FROM wallets w
            LEFT JOIN riders r ON w.rider_id = r.id
            LEFT JOIN users u ON w.user_id = u.id
            WHERE r.email = 'aaqueel@servenow.com' OR u.email = 'aaqueel@servenow.com'
        `);
        
        console.log('Wallets:', wallets);

        // Check riders table
        const [riders] = await connection.query(`
            SELECT * FROM riders WHERE email = 'aaqueel@servenow.com'
        `);
        
        console.log('Riders:', riders);

        // Check users table
        const [users] = await connection.query(`
            SELECT * FROM users WHERE email = 'aaqueel@servenow.com'
        `);
        
        console.log('Users:', users);
        
        // Check all tables that might contain financial data
        const [tables] = await connection.query(`
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'servenow'
        `);
        
        console.log('\nAll tables in database:', tables.map(t => t.TABLE_NAME));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}
check();
