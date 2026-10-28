const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow'
        });
        const [columns] = await conn.execute('SHOW COLUMNS FROM order_items');
        console.log(columns);
        await conn.end();
    } catch (e) {
        console.error(e);
    }
})();
