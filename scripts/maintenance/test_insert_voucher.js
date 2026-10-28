const mysql = require('mysql2/promise');
require('dotenv').config();

async function testInsert() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'servenow'
    };

    try {
        const connection = await mysql.createConnection(config);
        
        const voucher_number = 'TEST-' + Date.now();
        const voucher_date = new Date().toISOString().split('T')[0];
        const payee_name = 'Test Rider';
        const payee_type = 'rider';
        const payee_id = 1; // Assuming user/rider 1 exists (or no FK check so it passes)
        const amount = 100.00;
        const purpose = 'Test Purpose';
        const description = 'Test Description';
        const payment_method = 'cash';
        const prepared_by = 1; // Assuming admin user 1

        console.log('Attempting INSERT with corrected column names...');
        
        const [result] = await connection.execute(
            `INSERT INTO cash_payment_vouchers 
             (voucher_number, voucher_date, payee_name, payee_type, payee_id, amount, purpose, description, payment_method, check_number, bank_details, prepared_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
            [voucher_number, voucher_date, payee_name, payee_type, payee_id, amount, purpose, description, payment_method, null, null, prepared_by]
        );

        console.log('Insert successful, ID:', result.insertId);
        
        // Clean up
        await connection.execute('DELETE FROM cash_payment_vouchers WHERE id = ?', [result.insertId]);
        console.log('Cleaned up test record.');

        await connection.end();
    } catch (error) {
        console.error('INSERT FAILED:', error);
    }
}

testInsert();
