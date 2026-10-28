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

  console.log('Checking orders between', periodFrom, 'and', periodTo);
  
  // 1. Get Delivery Fees
  const [deliveryData] = await connection.execute(`
      SELECT SUM(delivery_fee) as total_fees
      FROM orders 
      WHERE status = 'delivered' 
      AND created_at BETWEEN ? AND ?
  `, [periodFrom, periodTo]);
  
  // 2. Get Item Profit Breakdown
  const [items] = await connection.execute(`
    SELECT 
        oi.id, oi.product_id, p.name, 
        oi.quantity, oi.price, 
        COALESCE(psp.cost_price, p.cost_price) as cost_price,
        (oi.price - COALESCE(psp.cost_price, p.cost_price)) * oi.quantity as profit
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products p ON oi.product_id = p.id
    LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id 
        AND ((oi.size_id IS NOT NULL AND psp.size_id = oi.size_id) OR (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id))
    WHERE o.status = 'delivered'
    AND o.created_at BETWEEN ? AND ?
  `, [periodFrom, periodTo]);

  const totalFees = parseFloat(deliveryData[0].total_fees || 0);
  const totalItemProfit = items.reduce((sum, item) => sum + parseFloat(item.profit || 0), 0);

  console.log('Total Delivery Fees:', totalFees);
  console.log('Total Item Profit:', totalItemProfit);
  console.log('Total Gross:', totalFees + totalItemProfit);
  console.log('------------------------------------------------');
  console.log('Item Breakdown:', JSON.stringify(items, null, 2));

  await connection.end();
}
check().catch(console.error);
