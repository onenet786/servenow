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
        const [users] = await conn.execute("SELECT email, password FROM users WHERE user_type = 'admin'");
        console.log(users);
        await conn.end();
    } catch (e) {
        console.error(e);
    }
})();
