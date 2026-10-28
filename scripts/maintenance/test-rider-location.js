const mysql = require('mysql2/promise');

async function checkColumns() {
    try {
        const pool = await mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow',
            port: process.env.DB_PORT || 3306
        });
        
        console.log('Testing rider location columns...\n');
        
        const [result] = await pool.execute("SHOW COLUMNS FROM orders WHERE Field LIKE 'rider_%'");
        console.log('Existing rider location columns:');
        console.log(result);
        
        if (!result.some(r => r.Field === 'rider_latitude')) {
            console.log('\nAdding rider_latitude column...');
            await pool.execute('ALTER TABLE orders ADD COLUMN rider_latitude DECIMAL(10, 8) NULL');
            console.log('✓ rider_latitude added');
        }
        
        if (!result.some(r => r.Field === 'rider_longitude')) {
            console.log('Adding rider_longitude column...');
            await pool.execute('ALTER TABLE orders ADD COLUMN rider_longitude DECIMAL(11, 8) NULL');
            console.log('✓ rider_longitude added');
        }
        
        const [finalResult] = await pool.execute("SHOW COLUMNS FROM orders WHERE Field LIKE 'rider_%'");
        console.log('\nFinal rider location columns:');
        console.log(finalResult);
        
        await pool.end();
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

checkColumns();
