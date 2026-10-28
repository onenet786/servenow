require('./_guard');
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'servenow',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

async function fixOrder(orderNumber) {
  const conn = await pool.getConnection();
  try {
    console.log(`\n=== Fixing Order ${orderNumber} ===\n`);

    const [orders] = await conn.execute(
      'SELECT id, total_amount, delivery_fee FROM orders WHERE order_number = ?',
      [orderNumber]
    );

    if (orders.length === 0) {
      console.log('Order not found!');
      return;
    }

    const orderId = orders[0].id;
    const deliveryFee = orders[0].delivery_fee;

    const [items] = await conn.execute(
      'SELECT id, product_id, quantity, price FROM order_items WHERE order_id = ?',
      [orderId]
    );

    console.log('Current items:');
    items.forEach(item => {
      console.log(`  ID ${item.id}: Product ${item.product_id}, Qty ${item.quantity}, Price ${item.price}, Total ${item.quantity * item.price}`);
    });

    let itemsSubtotal = 0;
    let itemToRemove = null;

    for (const item of items) {
      const itemTotal = item.quantity * item.price;
      if (itemTotal === deliveryFee) {
        console.log(`\n⚠️  Found delivery fee item: ID ${item.id} (Product ${item.product_id}, Price ${item.price})`);
        itemToRemove = item.id;
      } else {
        itemsSubtotal += itemTotal;
      }
    }

    if (itemToRemove) {
      console.log(`\nRemoving incorrect delivery fee item (ID ${itemToRemove})...`);
      await conn.execute(
        'DELETE FROM order_items WHERE id = ? AND order_id = ?',
        [itemToRemove, orderId]
      );

      const correctTotal = itemsSubtotal + deliveryFee;
      console.log(`\nRecalculating order total:`);
      console.log(`  Items subtotal: ${itemsSubtotal}`);
      console.log(`  Delivery fee: ${deliveryFee}`);
      console.log(`  New total: ${correctTotal}`);

      await conn.execute(
        'UPDATE orders SET total_amount = ? WHERE id = ?',
        [correctTotal, orderId]
      );

      console.log(`\n✅ Order ${orderNumber} fixed successfully!`);
    } else {
      console.log('\n✅ No delivery fee item found. Order appears to be correct.');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await conn.release();
    await pool.end();
  }
}

const orderNumber = process.argv[2] || 'Ord2601130005';
fixOrder(orderNumber);
