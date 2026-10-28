const mysql = require('mysql2/promise');
require('dotenv').config();
async function check() {
    try {
        const db = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost/servenow');
        const [orphans] = await db.query(`
            SELECT t.id 
            FROM wallet_transfers t 
            LEFT JOIN users u ON t.sender_id = u.id 
            WHERE u.id IS NULL
        `);
        console.log('Orphan transfers (sender):', orphans);
        
        const [orphans2] = await db.query(`
            SELECT t.id 
            FROM wallet_transfers t 
            LEFT JOIN users u ON t.recipient_id = u.id 
            WHERE u.id IS NULL
        `);
        console.log('Orphan transfers (recipient):', orphans2);
        
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
check();
