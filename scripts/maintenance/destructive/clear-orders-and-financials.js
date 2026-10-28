require('./_guard');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function clearOrdersAndFinancials() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('⚠ WARNING: This will DELETE ALL ORDERS and FINANCIAL DATA.');
        console.log('Starting cleanup process...\n');

        // Disable foreign key checks to avoid constraint errors during deletion
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        const tablesToClear = [
            'order_items',
            'payments',
            'refunds',
            'orders',
            'wallet_transactions',
            'wallet_transfers',
            'transfer_notifications',
            'rider_cash_movements',
            'financial_transactions',
            'cash_receipt_vouchers',
            'cash_payment_vouchers',
            'financial_reports',
            'store_settlements',
            'journal_voucher_entries',
            'journal_vouchers',
            'admin_expenses',
            'wallets'
        ];

        for (const table of tablesToClear) {
            try {
                const [result] = await connection.query(`DELETE FROM ${table}`);
                console.log(`✓ Deleted ${result.affectedRows} records from ${table}`);
                
                // Reset Auto Increment
                await connection.query(`ALTER TABLE ${table} AUTO_INCREMENT = 1`);
            } catch (err) {
                console.error(`Error clearing ${table}:`, err.message);
            }
        }

        // Enable foreign key checks back
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('\n✅ All orders and financial data cleared successfully!');
        console.log('The system is now ready for new orders and financial records.');

    } catch (e) {
        console.error('Fatal Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

clearOrdersAndFinancials();
