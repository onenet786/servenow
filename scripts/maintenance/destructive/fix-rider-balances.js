require('./_guard');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixRiderBalances() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('Starting rider wallet balance recalculation...\n');

        // Get all riders with wallets
        const [riders] = await connection.query(`
            SELECT DISTINCT r.id, r.email
            FROM riders r
            INNER JOIN wallets w ON w.rider_id = r.id
        `);

        console.log(`Found ${riders.length} riders with wallets\n`);

        for (const rider of riders) {
            console.log(`Processing rider: ${rider.email} (ID: ${rider.id})`);

            // Calculate correct balance:
            // Credit: Sum of delivery fees for ALL paid/delivered orders (Earnings)
            // Debit: Sum of total amount for CASH paid/delivered orders (Liability)
            
            // 1. Total Earnings (Credits)
            const [earnings] = await connection.query(`
                SELECT COALESCE(SUM(delivery_fee), 0) as total_fees
                FROM orders
                WHERE rider_id = ? AND payment_status = 'paid' AND status = 'delivered'
            `, [rider.id]);

            // 2. Total Cash Collected (Debits)
            const [cashCollected] = await connection.query(`
                SELECT COALESCE(SUM(total_amount), 0) as total_cash
                FROM orders
                WHERE rider_id = ? AND payment_method = 'cash' AND payment_status = 'paid' AND status = 'delivered'
            `, [rider.id]);

            const totalCredits = parseFloat(earnings[0].total_fees || 0);
            const totalDebits = parseFloat(cashCollected[0].total_cash || 0);
            const correctBalance = totalCredits - totalDebits;

            // Get current wallet balance
            const [wallets] = await connection.query(`
                SELECT id, balance FROM wallets WHERE rider_id = ?
            `, [rider.id]);

            if (wallets.length === 0) {
                console.log(`  ⚠️  No wallet found, skipping\n`);
                continue;
            }

            const wallet = wallets[0];
            const currentBalance = parseFloat(wallet.balance || 0);

            console.log(`  Current balance: ${currentBalance}`);
            console.log(`  Total Fees (Credit): ${totalCredits}`);
            console.log(`  Cash Collected (Debit): ${totalDebits}`);
            console.log(`  Correct balance: ${correctBalance}`);

            if (currentBalance !== correctBalance) {
                console.log(`  ✅ Updating balance from ${currentBalance} to ${correctBalance}`);
                
                await connection.query(`
                    UPDATE wallets 
                    SET balance = ?, total_credited = ?, total_spent = ?
                    WHERE id = ?
                `, [correctBalance, totalCredits, totalDebits, wallet.id]);

                console.log(`  ✅ Balance updated successfully`);
            } else {
                console.log(`  ✅ Balance is correct, no update needed`);
            }
            console.log('');
        }

        console.log('Rider balance recalculation complete!');

    } catch (error) {
        console.error('Error during balance recalculation:', error);
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
}

fixRiderBalances();
