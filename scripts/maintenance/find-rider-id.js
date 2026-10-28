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

        // Get all riders
        const [allRiders] = await connection.query(`
            SELECT id, email, first_name, last_name FROM riders ORDER BY id DESC LIMIT 20
        `);
        
        console.log('Last 20 riders:');
        allRiders.forEach(r => {
            console.log(`  ID: ${r.id}, Email: ${r.email}, Name: ${r.first_name} ${r.last_name}`);
        });

        // Check for aaqueel in any field
        const [searchResults] = await connection.query(`
            SELECT * FROM riders WHERE email LIKE '%aaqueel%' OR first_name LIKE '%aaqueel%' OR last_name LIKE '%aaqueel%'
        `);
        
        console.log('\nSearching for "aaqueel":', searchResults);

        // Get all orders and see which rider_ids are used
        const [riderOrders] = await connection.query(`
            SELECT DISTINCT rider_id, COUNT(*) as order_count, SUM(total_amount) as total_amount
            FROM orders
            WHERE rider_id IS NOT NULL AND status = 'delivered' AND payment_method = 'cash' AND payment_status = 'paid'
            GROUP BY rider_id
            ORDER BY total_amount DESC
        `);
        
        console.log('\nTop riders by cash received (delivered):');
        riderOrders.forEach(r => {
            console.log(`  Rider ID: ${r.rider_id}, Orders: ${r.order_count}, Total: PKR ${r.total_amount}`);
        });

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}
check();
