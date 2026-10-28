const mysql = require('mysql2/promise');
require('dotenv').config();

async function testAPI() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306,
            database: process.env.DB_NAME || 'servenow'
        });

        const orderId = 76; // Our test order
        
        // Simulate what the API endpoint returns
        const [deliveries] = await connection.query(`
            SELECT o.*, u.first_name, u.last_name, u.phone, s.name as store_name, s.location as store_location
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            WHERE o.id = ?
        `, [orderId]);

        const delivery = deliveries[0];
        
        // Fetch items like the API does
        const [items] = await connection.query(`
            SELECT oi.*, p.name as product_name, p.image_url, s.name as store_name
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN stores s ON oi.store_id = s.id
            WHERE oi.order_id = ?
        `, [orderId]);

        delivery.items = items;

        console.log('=== DELIVERY DATA FROM API ===');
        console.log(JSON.stringify({
            delivery: {
                id: delivery.id,
                order_number: delivery.order_number,
                total_amount: delivery.total_amount,
                delivery_fee: delivery.delivery_fee,
                items: delivery.items.map(i => ({
                    product_id: i.product_id,
                    price: i.price,
                    quantity: i.quantity
                }))
            }
        }, null, 2));

        console.log('\n=== DART CALCULATION ===');
        let itemsSubtotal = 0;
        delivery.items.forEach(item => {
            const price = parseFloat(item.price || 0);
            const qty = parseInt(item.quantity || 1);
            const lineTotal = price * qty;
            itemsSubtotal += lineTotal;
            console.log(`Item: price=${price}, qty=${qty}, lineTotal=${lineTotal}`);
        });

        console.log(`\nCalculated itemsSubtotal: ${itemsSubtotal.toFixed(2)}`);
        console.log(`Delivery Fee: ${delivery.delivery_fee}`);
        console.log(`Grand Total (from delivery.total_amount): ${delivery.total_amount}`);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        if (connection) await connection.end();
    }
}

testAPI();
