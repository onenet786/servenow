const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        // Find all riders that no longer exist
        const [orphanOrders] = await connection.query(`
            SELECT o.id, o.rider_id, o.total_amount, o.delivery_fee, o.payment_method, o.payment_status, o.status, o.created_at
            FROM orders o
            LEFT JOIN riders r ON o.rider_id = r.id
            WHERE o.rider_id IS NOT NULL AND r.id IS NULL
        `);
        
        console.log('Orders with non-existent riders:', orphanOrders);
        console.log(`Total orphan orders: ${orphanOrders.length}`);

        // Group by rider_id to see which riders are missing
        const riderIds = [...new Set(orphanOrders.map(o => o.rider_id))];
        console.log(`\nOrphan rider IDs: ${riderIds.join(', ')}`);

        // Get stats for the first orphan rider (if any)
        if (riderIds.length > 0) {
            const firstRiderId = riderIds[0];
            const [stats] = await connection.query(`
                SELECT 
                    COUNT(*) as order_count,
                    SUM(CASE WHEN payment_method = 'cash' AND payment_status = 'paid' AND status = 'delivered' THEN total_amount ELSE 0 END) as cash_received,
                    SUM(CASE WHEN status = 'delivered' AND payment_method != 'cash' THEN delivery_fee ELSE 0 END) as delivery_fees
                FROM orders o
                WHERE o.rider_id = ? AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            `, [firstRiderId]);
            
            console.log(`\nStats for orphan rider ${firstRiderId} (weekly):`, stats);
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}
check();
