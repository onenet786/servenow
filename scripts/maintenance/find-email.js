const mysql = require('mysql2/promise');
require('dotenv').config();

async function findEmail() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        const email = 'aaqueel@servenow.com';

        // Check all relevant tables for this email
        const tables = [
            'users', 'riders', 'wallets', 'wallet_transactions', 
            'rider_cash_movements', 'financial_transactions', 
            'cash_receipt_vouchers', 'cash_payment_vouchers',
            'financial_reports', 'store_settlements'
        ];

        for (const table of tables) {
            try {
                const [rows] = await connection.query(`SELECT * FROM ${table} WHERE email = ?`, [email]);
                if (rows.length > 0) {
                    console.log(`\n${table}:`, rows);
                }
            } catch (e) {
                // Column doesn't exist, skip
            }
        }

        // Also search for cash movements or transactions mentioning the email
        const [riderCash] = await connection.query(`
            SELECT rcm.*, r.email FROM rider_cash_movements rcm
            LEFT JOIN riders r ON rcm.rider_id = r.id
            WHERE r.email = ?
        `, [email]);
        
        if (riderCash.length > 0) {
            console.log('\nRider Cash Movements:', riderCash);
        }

        const [walletTx] = await connection.query(`
            SELECT wt.*, w.user_id, w.rider_id FROM wallet_transactions wt
            LEFT JOIN wallets w ON wt.wallet_id = w.id
            WHERE wt.wallet_id IN (
                SELECT id FROM wallets WHERE user_id IN (
                    SELECT id FROM users WHERE email = ?
                ) OR rider_id IN (
                    SELECT id FROM riders WHERE email = ?
                )
            )
        `, [email, email]);
        
        if (walletTx.length > 0) {
            console.log('\nWallet Transactions:', walletTx);
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}
findEmail();
