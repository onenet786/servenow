require('./_guard');
const mysql = require('mysql2/promise');

async function patchOrder2() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  console.log('Patching Order Ord2602070001 items to have 10% discount...');
  
  const [result] = await connection.execute(`
      UPDATE order_items 
      SET discount_type = 'percent', discount_value = 10.00
      WHERE order_id IN (
        SELECT id FROM orders WHERE order_number = 'Ord2602070001'
      )
  `);

  console.log('Updated', result.affectedRows, 'items.');
  
  await connection.end();
}
patchOrder2().catch(console.error);
