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
        const [rows] = await conn.execute('DESCRIBE stores');
        console.table(rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
