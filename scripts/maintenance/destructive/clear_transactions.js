require('./_guard');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function clearTransactions() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'servenow',
        multipleStatements: true
    };

    console.log(`Connecting to database: ${config.database}...`);
    
    let connection;
    try {
        connection = await mysql.createConnection(config);
        console.log('Connected.');

        // Tables to TRUNCATE (Clear all data)
        const tablesToTruncate = [
            'orders',
            'order_items',
            'order_sequences',
            'payments',
            'financial_transactions',
            'wallet_transactions',
            'wallet_transfers',
            'cash_payment_vouchers',
            'cash_receipt_vouchers',
            'journal_vouchers',
            'journal_voucher_entries',
            'financial_reports',
            'admin_expenses',
            'rider_cash_movements',
            'store_settlements',
            'transfer_notifications',
            'login_logs'
        ];

        console.log('Disabling foreign key checks...');
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        console.log('Clearing transaction tables...');
        for (const table of tablesToTruncate) {
            try {
                // Check if table exists first to avoid errors
                const [rows] = await connection.query(`SHOW TABLES LIKE '${table}'`);
                if (rows.length > 0) {
                    await connection.query(`TRUNCATE TABLE ${table}`);
                    console.log(`✓ Truncated ${table}`);
                } else {
                    console.log(`- Table ${table} not found, skipping.`);
                }
            } catch (err) {
                console.error(`x Failed to truncate ${table}: ${err.message}`);
            }
        }

        console.log('Resetting wallet balances...');
        try {
            await connection.query(`
                UPDATE wallets 
                SET balance = 0.00, 
                    total_credited = 0.00, 
                    total_spent = 0.00, 
                    last_credited_at = NULL,
                    auto_recharge_enabled = 0,
                    auto_recharge_amount = 0.00,
                    auto_recharge_threshold = 0.00
            `);
            console.log('✓ Wallets reset to 0.00');
        } catch (err) {
            console.error(`x Failed to reset wallets: ${err.message}`);
        }

        console.log('Enabling foreign key checks...');
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('\nDatabase cleanup complete!');
        console.log('Kept tables: users, riders, stores, products, categories, units, sizes, items, saved_payment_methods, riders_fuel_history, wallets (reset).');

    } catch (error) {
        console.error('Fatal error:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

clearTransactions();
