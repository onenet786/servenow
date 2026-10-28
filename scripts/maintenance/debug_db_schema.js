const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSchema() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'servenow'
    };

    try {
        const connection = await mysql.createConnection(config);
        
        console.log('--- cash_payment_vouchers columns ---');
        const [vouchersCols] = await connection.execute('SHOW COLUMNS FROM cash_payment_vouchers');
        vouchersCols.forEach(col => {
            console.log(`Field: ${col.Field}, Type: ${col.Type}`);
        });

        await connection.end();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkSchema();
