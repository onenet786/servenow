const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('Running migration...');
        
        // Delete all wallet records
        const [result] = await connection.query('DELETE FROM wallets');
        console.log(`Deleted ${result.affectedRows} wallet records`);
        
        console.log('Migration successful');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        if (connection) await connection.end();
    }
}
migrate();
