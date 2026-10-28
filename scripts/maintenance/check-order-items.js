const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkOrderItems() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        const orderId = 76; // From our search
        
        // Get order 
        const [orders] = await connection.query(`
            SELECT * FROM orders WHERE id = ?
        `, [orderId]);
        
        const order = orders[0];
        console.log('=== ORDER DETAILS ===');
        console.log(`Order ID: ${order.id}`);
        console.log(`Order Number: ${order.order_number}`);
        console.log(`Total Amount (DB): PKR ${order.total_amount}`);
        console.log(`Delivery Fee (DB): PKR ${order.delivery_fee}`);
        console.log(`Status: ${order.status}`);

        // Get order items
        const [items] = await connection.query(`
            SELECT id, product_id, price, quantity FROM order_items WHERE order_id = ?
        `, [orderId]);
        
        console.log('\n=== ORDER ITEMS ===');
        let calculatedSubtotal = 0;
        items.forEach((item, idx) => {
            const itemTotal = parseFloat(item.price) * parseInt(item.quantity);
            calculatedSubtotal += itemTotal;
            console.log(`Item ${idx + 1}: Product#${item.product_id}, Price: PKR ${item.price}, Qty: ${item.quantity}, Total: PKR ${itemTotal.toFixed(2)}`);
        });

        console.log(`\n=== CALCULATION ===`);
        console.log(`Items Subtotal (calculated): PKR ${calculatedSubtotal.toFixed(2)}`);
        console.log(`Delivery Fee (from DB): PKR ${order.delivery_fee}`);
        console.log(`Grand Total (should be): PKR ${(calculatedSubtotal + parseFloat(order.delivery_fee)).toFixed(2)}`);
        console.log(`Grand Total (in DB): PKR ${order.total_amount}`);
        
        console.log(`\n=== ISSUE ===`);
        console.log(`Expected items subtotal: 700`);
        console.log(`Actual items subtotal: ${calculatedSubtotal.toFixed(2)}`);
        console.log(`Expected grand total: 800`);
        console.log(`Actual grand total (DB): ${order.total_amount}`);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

checkOrderItems();
