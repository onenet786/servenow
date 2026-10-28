const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkColumns() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        const [rows] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = '${process.env.DB_NAME}' 
            AND TABLE_NAME = 'products'
        `);

        console.log('Product Columns:', rows.map(r => r.COLUMN_NAME));
        
        const [rows2] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = '${process.env.DB_NAME}' 
            AND TABLE_NAME = 'order_items'
        `);
        
        console.log('Order Items Columns:', rows2.map(r => r.COLUMN_NAME));

        await connection.end();
    } catch (e) {
        console.error(e);
    }
}

checkColumns();
