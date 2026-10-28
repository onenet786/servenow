const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

(async () => {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('--- Stores with is_open column ---');
        const [stores] = await conn.execute('SELECT id, name, opening_time, closing_time, is_active, is_open FROM stores');
        console.table(stores);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
