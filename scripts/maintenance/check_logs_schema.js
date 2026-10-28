const mysql = require('mysql2/promise');
require('dotenv').config();
async function check() {
    try {
        const db = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost/servenow');
        const [cols] = await db.query('SHOW COLUMNS FROM login_logs');
        console.log('login_logs columns:', cols.map(c => c.Field));
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
check();
