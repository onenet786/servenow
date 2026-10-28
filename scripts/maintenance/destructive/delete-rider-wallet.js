require('./_guard');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function deleteRiderWallet() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        // Find rider by email
        const [riders] = await connection.query(`
            SELECT id, email FROM riders WHERE email = ?
        `, ['aaqueel@servenow.pk']);

        if (riders.length === 0) {
            console.log('❌ Rider with email aaqueel@servenow.pk not found');
            return;
        }

        const riderId = riders[0].id;
        console.log(`Found rider: ${riders[0].email} (ID: ${riderId})`);

        // Get wallet ID
        const [wallets] = await connection.query(`
            SELECT id FROM wallets WHERE rider_id = ?
        `, [riderId]);

        if (wallets.length === 0) {
            console.log('⚠️  No wallet found for this rider');
            return;
        }

        const walletId = wallets[0].id;
        console.log(`Found wallet ID: ${walletId}`);

        // Delete wallet transactions
        const [txnResult] = await connection.query(`
            DELETE FROM wallet_transactions WHERE wallet_id = ?
        `, [walletId]);
        console.log(`✅ Deleted ${txnResult.affectedRows} wallet transactions`);

        // Delete wallet
        const [walletResult] = await connection.query(`
            DELETE FROM wallets WHERE id = ?
        `, [walletId]);
        console.log(`✅ Deleted wallet record`);

        console.log('\n✅ Wallet data deleted successfully for rider aaqueel@servenow.pk');
        console.log('You can now rerun fix-rider-balances.js to recalculate from orders');

    } catch (error) {
        console.error('Error deleting wallet data:', error);
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
}

deleteRiderWallet();
