const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const todayFrom = '2026-02-01 00:00:00'; 
  const todayTo = '2026-02-09 23:59:59';

  console.log('Checking orders...');
  
  const [orders] = await connection.execute(`
      SELECT o.id, o.order_number, o.created_at, o.delivery_fee, o.total_amount
      FROM orders o
      WHERE o.status = 'delivered' AND o.created_at BETWEEN ? AND ?
  `, [todayFrom, todayTo]);

  console.log('Found', orders.length, 'orders.');
  
  for (const o of orders) {
      console.log(`Order ${o.order_number} (${o.created_at}): Fee ${o.delivery_fee}`);
      
      const [items] = await connection.execute(`
          SELECT quantity, price, discount_type, discount_value 
          FROM order_items WHERE order_id = ?
      `, [o.id]);
      
      items.forEach(i => {
          console.log(`  - Qty: ${i.quantity}, Price: ${i.price}, Disc: ${i.discount_value || 0}`);
      });
  }

  await connection.end();
}
check().catch(console.error);
