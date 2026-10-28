const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const storeName = 'Bannu Beef Pulao'; 
  console.log('Searching for store:', storeName);
  const [stores] = await connection.execute('SELECT id, name FROM stores WHERE name LIKE ?', [`%${storeName}%`]);
  
  if (stores.length === 0) {
      console.log('Store not found');
      process.exit();
  }
  const storeId = stores[0].id;
  console.log('Found store:', stores[0]);

  // Check for delivered & paid orders for this store
  const query = `
    SELECT 
        oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price, 
        o.order_number, o.status, o.payment_status,
        oi.settlement_id
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products p ON oi.product_id = p.id
    JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
    WHERE s.id = ?
    AND o.status = 'delivered'
    ORDER BY o.created_at DESC
  `;
  
  const [items] = await connection.execute(query, [storeId]);
  console.log(`Found ${items.length} items.`);
  console.log(JSON.stringify(items.slice(0, 5), null, 2));

  await connection.end();
}
check().catch(console.error);
