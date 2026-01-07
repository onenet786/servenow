const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'servenow',
        port: process.env.DB_PORT || 3306
    });

    const [riders] = await db.execute('SELECT id, email FROM riders WHERE email = ?', ['aaqueel@gmail.com']);
    console.log('Rider Data:', riders);

    const [orderCheck] = await db.execute('SELECT id, order_number, rider_id, store_id, status FROM orders WHERE LOWER(order_number) LIKE LOWER(?)', ['%2601070005%']);
    console.log('Search Result for 2601070005:', orderCheck);

    await db.end();
}
check().catch(console.error);
