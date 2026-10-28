const mysql = require('mysql2/promise');
require('dotenv').config();

async function findOrder() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        // Search for orders with that number
        const [orders] = await connection.query(`
            SELECT id, order_number, total_amount, delivery_fee, status FROM orders 
            WHERE order_number LIKE '%2601130005%' OR order_number LIKE '%Ord2601130005%'
            LIMIT 5
        `);
        
        console.log('Found orders:', orders);

        // Also show recent orders to understand the format
        const [recent] = await connection.query(`
            SELECT id, order_number, total_amount, delivery_fee, status FROM orders 
            ORDER BY id DESC LIMIT 10
        `);
        
        console.log('\nRecent orders:');
        recent.forEach(o => {
            console.log(`ID: ${o.id}, Order#: ${o.order_number}, Total: PKR ${o.total_amount}, Fee: PKR ${o.delivery_fee}`);
        });

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

findOrder();
