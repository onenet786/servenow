const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    try {
        const db = await mysql.createConnection(process.env.DATABASE_URL || 'mysql://root:@localhost/servenow');
        
        // Test NaN limit/offset
        const badLimit = parseInt("");
        const badOffset = parseInt("");
        console.log('Testing with NaN limit/offset:', badLimit, badOffset);
        try {
            await db.query('SELECT * FROM wallet_transfers LIMIT ? OFFSET ?', [badLimit, badOffset]);
            console.log('NaN limit/offset OK');
        } catch (e) {
            console.error('NaN limit/offset FAILED:', e.message);
        }

        const [userCols] = await db.query('SHOW COLUMNS FROM users');
        console.log('User columns:', userCols.map(c => c.Field));
        
        // Mock userId 1 (admin)
        const userId = 1;
        const limit = 20;
        const offset = 0;

        const [cols] = await db.query('SHOW COLUMNS FROM wallet_transfers');
        for (let col of cols) {
            try {
                const [res] = await db.query(`SELECT ${col.Field} FROM wallet_transfers LIMIT 1`);
                console.log(`Column ${col.Field} is OK`);
            } catch (e) {
                console.error(`Column ${col.Field} is BAD:`, e.message);
            }
        }

        let query = `SELECT t.*, u.email as sender_email, CONCAT(u.first_name, ' ', u.last_name) as sender_name
                   FROM wallet_transfers t
                   JOIN users u ON t.sender_id = u.id
                   WHERE t.recipient_id = ?`;
        let params = [userId];
        
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        console.log('Running query:', query);
        console.log('Params:', params);
        
        const [explain] = await db.execute('EXPLAIN ' + query, params);
        console.log('EXPLAIN:', explain);

        const [transfers] = await db.query(query, params);
        console.log('Transfers:', transfers);
        try {
            JSON.stringify(transfers);
            console.log('Transfers are JSON serializable');
        } catch (e) {
            console.error('Transfers are NOT JSON serializable:', e.message);
        }

        const [totalExplain] = await db.query('EXPLAIN SELECT COUNT(*) as count FROM wallet_transfers WHERE recipient_id = ?', [userId]);
        console.log('TOTAL EXPLAIN:', totalExplain);

        const [totalRes] = await db.query(
            'SELECT COUNT(*) as count FROM wallet_transfers WHERE recipient_id = ?',
            [userId]
        );
        console.log('Total result raw:', totalRes[0]);
        const total = totalRes[0].count;
        console.log('Total count:', total);
        console.log('Type of count:', typeof total);
        if (typeof total === 'bigint') {
            console.log('Count is BIGINT');
        }

        process.exit(0);
    } catch (e) {
        console.error('ERROR:', e.message);
        console.error(e.stack);
        process.exit(1);
    }
}
check();
