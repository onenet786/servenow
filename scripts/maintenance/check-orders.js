require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'servenow'
});

(async () => {
  try {
    const conn = await pool.getConnection();
    const [orders] = await conn.execute(
      'SELECT order_number, id, total_amount, delivery_fee FROM orders ORDER BY id DESC LIMIT 10'
    );
    console.log('Recent orders:');
    orders.forEach(o => console.log(`  ${o.order_number}: ID=${o.id}, Total=${o.total_amount}, DeliveryFee=${o.delivery_fee}`));
    
    console.log('\nSearching for orders with delivery_fee=100...');
    const [matches] = await conn.execute(
      'SELECT order_number, id, total_amount, delivery_fee FROM orders WHERE delivery_fee = 100 LIMIT 10'
    );
    if (matches.length === 0) {
      console.log('  No orders with delivery_fee=100 found');
    } else {
      matches.forEach(m => console.log(`  ${m.order_number}: ID=${m.id}, Total=${m.total_amount}`));
    }
    
    await conn.release();
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
