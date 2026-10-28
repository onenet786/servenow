const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        const orderId = 76;
        
        // Get order items with store details
        const [items] = await connection.query(`
            SELECT oi.id, oi.product_id, oi.price, oi.quantity, oi.store_id, 
                   p.name as product_name, s.name as store_name
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN stores s ON oi.store_id = s.id
            WHERE oi.order_id = ?
        `, [orderId]);
        
        console.log('=== ORDER ITEMS WITH STORE INFO ===');
        const storeIds = new Set();
        items.forEach(item => {
            storeIds.add(item.store_id);
            console.log(`Product: ${item.product_name}, Store: ${item.store_name} (ID: ${item.store_id}), Price: ${item.price}, Qty: ${item.quantity}`);
        });

        console.log(`\nNumber of unique stores: ${storeIds.size}`);
        console.log(`Store IDs: ${Array.from(storeIds).join(', ')}`);

        // Calculate expected delivery fee based on store count
        const storeCount = storeIds.size;
        let expectedFee = 70;
        if (storeCount === 2) {
            expectedFee = 100;
        } else if (storeCount >= 3) {
            expectedFee = 130 + (storeCount - 3) * 30;
        }
        
        console.log(`\nExpected delivery fee for ${storeCount} store(s): PKR ${expectedFee}`);

        // Get order details
        const [orders] = await connection.query(`
            SELECT total_amount, delivery_fee FROM orders WHERE id = ?
        `, [orderId]);
        
        const order = orders[0];
        console.log(`Actual delivery fee in DB: PKR ${order.delivery_fee}`);
        console.log(`Total amount in DB: PKR ${order.total_amount}`);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

check();
