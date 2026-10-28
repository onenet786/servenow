const mysql = require('mysql2/promise');

async function checkCost() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const periodFrom = '2026-02-01 00:00:00';
  const periodTo = '2026-02-09 23:59:59';

  console.log('Checking Price vs Cost...');
  
  const [items] = await connection.execute(`
      SELECT 
        oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price, 
        p.name, 
        COALESCE(psp.cost_price, p.cost_price) as cost_price
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id 
        AND ((oi.size_id IS NOT NULL AND psp.size_id = oi.size_id) OR (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id))
      WHERE o.status = 'delivered' AND o.created_at BETWEEN ? AND ?
  `, [periodFrom, periodTo]);

  let totalSales = 0;
  let totalCost = 0;

  items.forEach(i => {
      const sales = parseFloat(i.price) * i.quantity;
      const cost = parseFloat(i.cost_price) * i.quantity;
      totalSales += sales;
      totalCost += cost;
      
      if (sales !== cost) {
          console.log(`DIFF FOUND: Item ${i.id} (${i.name}): Price ${sales}, Cost ${cost}, Diff ${sales - cost}`);
      }
  });
  
  console.log('Total Sales:', totalSales);
  console.log('Total Cost (DB):', totalCost);
  console.log('Difference:', totalSales - totalCost);

  await connection.end();
}
checkCost().catch(console.error);
