require('./_guard');
const mysql = require('mysql2/promise');

async function patchNewOrder() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  console.log('Patching Feb 7 order items to have 10% discount...');
  
  const [result] = await connection.execute(`
      UPDATE order_items 
      SET discount_type = 'percent', discount_value = 10.00
      WHERE order_id IN (
        SELECT id FROM orders WHERE order_number = 'Ord2602070002'
      )
  `);

  console.log('Updated', result.affectedRows, 'items.');
  
  await connection.end();
}
patchNewOrder().catch(console.error);
