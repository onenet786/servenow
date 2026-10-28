const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const periodFrom = '2026-02-01 00:00:00';
  const periodTo = '2026-02-06 23:59:59';

  console.log('Checking Discount Data in order_items...');
  
  const [items] = await connection.execute(`
      SELECT id, product_id, quantity, price, discount_type, discount_value 
      FROM order_items 
      WHERE order_id IN (
        SELECT id FROM orders WHERE status = 'delivered' AND created_at BETWEEN ? AND ?
      )
  `, [periodFrom, periodTo]);

  console.log('Found', items.length, 'items.');
  items.forEach(i => {
      console.log(`Item ${i.id}: Price ${i.price}, DiscType: ${i.discount_type}, DiscVal: ${i.discount_value}`);
  });

  await connection.end();
}
check().catch(console.error);
