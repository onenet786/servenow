const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    try {
        const db = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost/servenow');
        
        const [rows] = await db.query('SELECT * FROM wallet_transfers');
        console.log('wallet_transfers:', rows);

        process.exit(0);
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
    }
}
check();
