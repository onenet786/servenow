const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkTotals() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        // Find orders where total_amount looks like concatenated strings
        const [orders] = await connection.query(`
            SELECT id, order_number, total_amount, delivery_fee FROM orders
            ORDER BY id DESC LIMIT 20
        `);
        
        console.log('Recent orders:');
        for (const order of orders) {
            const total = parseFloat(order.total_amount);
            const fee = parseFloat(order.delivery_fee);
            
            // Get items subtotal
            const [items] = await connection.query(`
                SELECT SUM(price * quantity) as subtotal FROM order_items WHERE order_id = ?
            `, [order.id]);
            
            const itemsSubtotal = items[0]?.subtotal ? parseFloat(items[0].subtotal) : 0;
            const expectedTotal = itemsSubtotal + fee;
            
            const isWrong = Math.abs(total - expectedTotal) > 0.01;
            
            console.log(`\nOrder #${order.order_number} (ID: ${order.id})`);
            console.log(`  Items Subtotal: ${itemsSubtotal.toFixed(2)}`);
            console.log(`  Delivery Fee: ${fee.toFixed(2)}`);
            console.log(`  Expected Total: ${expectedTotal.toFixed(2)}`);
            console.log(`  Actual Total: ${total.toFixed(2)}`);
            console.log(`  Status: ${isWrong ? '❌ MISMATCH' : '✓ Correct'}`);
            
            if (isWrong) {
                console.log(`  Discrepancy: ${(total - expectedTotal).toFixed(2)}`);
            }
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

checkTotals();
