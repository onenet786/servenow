const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkOrder() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        const orderId = '2601130005'; // From order number
        
        // Get order details
        const [orders] = await connection.query(`
            SELECT * FROM orders WHERE order_number = ? OR id = ?
        `, [orderId, orderId]);
        
        console.log('Order Details:');
        console.log(JSON.stringify(orders, null, 2));

        if (orders.length > 0) {
            const order = orders[0];
            
            // Get order items
            const [items] = await connection.query(`
                SELECT * FROM order_items WHERE order_id = ?
            `, [order.id]);
            
            console.log('\nOrder Items:');
            console.log(JSON.stringify(items, null, 2));

            // Calculate subtotal
            let subtotal = 0;
            items.forEach(item => {
                console.log(`Item: ${item.product_id}, Price: ${item.price}, Qty: ${item.quantity}, Total: ${item.price * item.quantity}`);
                subtotal += item.price * item.quantity;
            });

            console.log(`\n--- Summary ---`);
            console.log(`Items Subtotal (calculated): PKR ${subtotal.toFixed(2)}`);
            console.log(`Delivery Fee (from DB): PKR ${order.delivery_fee || 0}`);
            console.log(`Grand Total (from DB): PKR ${order.total_amount || 0}`);
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

checkOrder();
