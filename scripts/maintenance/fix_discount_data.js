const mysql = require('mysql2/promise');

async function fix() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const periodFrom = '2026-02-01 00:00:00';
  const periodTo = '2026-02-06 23:59:59';

  console.log('Patching orders to have 10% discount...');
  
  // Update items to have 10% discount
  const [result] = await connection.execute(`
      UPDATE order_items 
      SET discount_type = 'percent', discount_value = 10.00
      WHERE order_id IN (
        SELECT id FROM orders WHERE status = 'delivered' AND created_at BETWEEN ? AND ?
      )
  `, [periodFrom, periodTo]);

  console.log('Updated', result.affectedRows, 'items.');
  
  await connection.end();
}
fix().catch(console.error);
