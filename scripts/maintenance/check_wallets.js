const mysql = require('mysql2/promise');
require('dotenv').config();
async function check() {
    try {
        const db = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost/servenow');
        const [usersWithoutWallets] = await db.query(`
            SELECT id, email FROM users 
            WHERE id NOT IN (SELECT user_id FROM wallets)
        `);
        console.log('Users without wallets:', usersWithoutWallets);
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
check();
