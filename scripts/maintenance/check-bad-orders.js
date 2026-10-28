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
    
    console.log('Checking specific orders...\n');
    
    const [result] = await conn.execute(`
      SELECT 
        o.id,
        o.order_number,
        o.total_amount,
        o.delivery_fee,
        COALESCE(SUM(oi.quantity * oi.price), 0) as calculated_subtotal,
        (COALESCE(SUM(oi.quantity * oi.price), 0) + o.delivery_fee) as correct_total
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.order_number IN ('Ord2601090017', 'Ord2601090018', 'Ord2601100009', 'Ord2601100011')
      GROUP BY o.id
    `);
    
    result.forEach(r => {
      console.log(`${r.order_number} (ID ${r.id}):`);
      console.log(`  Items Subtotal: ${r.calculated_subtotal}`);
      console.log(`  Delivery Fee: ${r.delivery_fee}`);
      console.log(`  DB Total: ${r.total_amount}`);
      console.log(`  Correct Total: ${r.correct_total}`);
      console.log(`  Match: ${r.total_amount == r.correct_total ? '✅' : '❌'}\n`);
    });
    
    await conn.release();
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
