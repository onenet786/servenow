require('./_guard');
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'servenow',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

async function fixAllOrders() {
  const conn = await pool.getConnection();
  try {
    console.log('=== Fixing All Orders with Incorrect Totals ===\n');

    const [badOrders] = await conn.execute(`
      SELECT 
        o.id,
        o.order_number,
        o.total_amount,
        o.delivery_fee,
        COALESCE(SUM(oi.quantity * oi.price), 0) as calculated_subtotal
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      HAVING calculated_subtotal + o.delivery_fee != o.total_amount
      ORDER BY o.id ASC
    `);

    if (badOrders.length === 0) {
      console.log('✅ All orders have correct totals!');
      await pool.end();
      return;
    }

    console.log(`Found ${badOrders.length} orders with incorrect totals:\n`);

    let fixedCount = 0;
    for (const order of badOrders) {
      const correctTotal = parseFloat(order.calculated_subtotal) + parseFloat(order.delivery_fee);
      const oldTotal = parseFloat(order.total_amount);

      console.log(`${order.order_number} (ID ${order.id}):`);
      console.log(`  Items Subtotal: ${order.calculated_subtotal}`);
      console.log(`  Delivery Fee: ${order.delivery_fee}`);
      console.log(`  Old Total: ${oldTotal}`);
      console.log(`  Correct Total: ${correctTotal}`);
      console.log(`  Difference: ${(correctTotal - oldTotal).toFixed(2)}`);

      await conn.execute(
        'UPDATE orders SET total_amount = ? WHERE id = ?',
        [correctTotal, order.id]
      );

      console.log(`  ✅ Fixed\n`);
      fixedCount++;
    }

    console.log(`\n=== Summary ===`);
    console.log(`✅ Fixed ${fixedCount} orders`);

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixAllOrders();
