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
  const periodTo = '2026-02-09 23:59:59';

  console.log('Checking orders...');
  
  const [orders] = await connection.execute(`
      SELECT o.id, o.order_number, o.created_at, o.delivery_fee, o.total_amount
      FROM orders o
      WHERE o.status = 'delivered' AND o.created_at BETWEEN ? AND ?
  `, [periodFrom, periodTo]);

  console.log('Found', orders.length, 'orders.');
  
  let totalDelivery = 0;
  let totalCost = 0;
  let totalDiscount = 0;

  for (const o of orders) {
      console.log(`Order ${o.order_number} (${o.created_at}): Fee ${o.delivery_fee}`);
      totalDelivery += parseFloat(o.delivery_fee);
      
      const [items] = await connection.execute(`
          SELECT id, product_id, quantity, price, discount_type, discount_value 
          FROM order_items WHERE order_id = ?
      `, [o.id]);
      
      let orderCost = 0;
      let orderDiscount = 0;

      items.forEach(i => {
          const qty = parseFloat(i.quantity);
          const price = parseFloat(i.price);
          const val = parseFloat(i.discount_value || 0);
          
          let discountAmount = 0;
          if (i.discount_type === 'percent') {
              discountAmount = qty * price * (val / 100);
          } else if (i.discount_type === 'amount') {
              discountAmount = qty * val;
          }
          
          orderDiscount += discountAmount;
          console.log(`  - Item ${i.id}: Qty ${qty}, Price ${price}, DiscType ${i.discount_type}, DiscVal ${val} -> CalcDisc: ${discountAmount}`);
      });
      totalDiscount += orderDiscount;
  }
  
  console.log('--- Summary ---');
  console.log('Total Delivery:', totalDelivery);
  console.log('Total Discount:', totalDiscount);

  await connection.end();
}
check().catch(console.error);
