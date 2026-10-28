require('./_guard');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function clearFinancialData() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('Clearing all financial data for all riders...\n');

        // 1. Delete all wallet records (already done but doing again)
        const [walletResult] = await connection.query('DELETE FROM wallets');
        console.log(`✓ Deleted ${walletResult.affectedRows} wallet records`);

        // 2. Delete all wallet transactions
        const [txResult] = await connection.query('DELETE FROM wallet_transactions');
        console.log(`✓ Deleted ${txResult.affectedRows} wallet transaction records`);

        // 3. Delete all rider cash movements
        const [cashMovResult] = await connection.query('DELETE FROM rider_cash_movements');
        console.log(`✓ Deleted ${cashMovResult.affectedRows} rider cash movement records`);

        // 4. Delete all financial transactions
        const [finResult] = await connection.query('DELETE FROM financial_transactions');
        console.log(`✓ Deleted ${finResult.affectedRows} financial transaction records`);

        // 5. Delete all cash receipt vouchers
        const [crResult] = await connection.query('DELETE FROM cash_receipt_vouchers');
        console.log(`✓ Deleted ${crResult.affectedRows} cash receipt voucher records`);

        // 6. Delete all cash payment vouchers
        const [cpResult] = await connection.query('DELETE FROM cash_payment_vouchers');
        console.log(`✓ Deleted ${cpResult.affectedRows} cash payment voucher records`);

        // 7. Delete all financial reports
        const [frResult] = await connection.query('DELETE FROM financial_reports');
        console.log(`✓ Deleted ${frResult.affectedRows} financial report records`);

        // 8. Clear rider_id from all orders (keep orders but remove rider association)
        const [orderResult] = await connection.query('UPDATE orders SET rider_id = NULL');
        console.log(`✓ Cleared rider_id from ${orderResult.affectedRows} orders`);

        // 9. Delete all store settlements
        const [ssResult] = await connection.query('DELETE FROM store_settlements');
        console.log(`✓ Deleted ${ssResult.affectedRows} store settlement records`);

        // 10. Delete all wallet transfers
        const [wtResult] = await connection.query('DELETE FROM wallet_transfers');
        console.log(`✓ Deleted ${wtResult.affectedRows} wallet transfer records`);

        console.log('\n✅ All financial data cleared successfully!');

    } catch (e) {
        console.error('Error:', e.message);
        console.error('Details:', e);
    } finally {
        if (connection) await connection.end();
    }
}

clearFinancialData();
