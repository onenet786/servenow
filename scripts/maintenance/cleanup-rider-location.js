const mysql = require('mysql2/promise');

async function cleanup() {
    try {
        const pool = await mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow',
            port: process.env.DB_PORT || 3306
        });
        
        console.log('Cleaning up rider location data...\n');
        
        // Ensure columns exist
        try {
            await pool.execute('ALTER TABLE orders ADD COLUMN rider_latitude DECIMAL(10, 8) NULL');
            console.log('✓ Added rider_latitude column');
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') throw e;
            console.log('✓ rider_latitude column already exists');
        }
        
        try {
            await pool.execute('ALTER TABLE orders ADD COLUMN rider_longitude DECIMAL(11, 8) NULL');
            console.log('✓ Added rider_longitude column');
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') throw e;
            console.log('✓ rider_longitude column already exists');
        }
        
        // Clear old binary data from rider_location
        const [result] = await pool.execute('UPDATE orders SET rider_location = NULL WHERE rider_location IS NOT NULL AND rider_location != "Delivered to customer"');
        console.log(`✓ Cleared ${result.affectedRows} rows with binary location data from rider_location column`);
        
        // Show final state
        const [orders] = await pool.execute('SELECT COUNT(*) as total, COUNT(rider_latitude) as with_lat, COUNT(rider_longitude) as with_lng FROM orders');
        console.log('\nFinal state:');
        console.log(`  Total orders: ${orders[0].total}`);
        console.log(`  Orders with latitude: ${orders[0].with_lat}`);
        console.log(`  Orders with longitude: ${orders[0].with_lng}`);
        
        await pool.end();
        console.log('\n✓ Cleanup complete!');
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

cleanup();
