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

  console.log('--- Financial Ledger Dump (Income Only) ---');
  
  const [txns] = await connection.execute(`
      SELECT id, transaction_number, transaction_type, category, description, amount, created_at 
      FROM financial_transactions 
      WHERE transaction_type IN ('income', 'adjustment')
      AND created_at BETWEEN ? AND ?
  `, [periodFrom, periodTo]);

  let totalIncome = 0;
  txns.forEach(t => {
      console.log(`[${t.created_at}] ${t.transaction_number} | ${t.category} | ${t.description} | + ${t.amount}`);
      totalIncome += parseFloat(t.amount);
  });
  
  console.log('-------------------------------------------');
  console.log('Total Income Found:', totalIncome);

  await connection.end();
}
check().catch(console.error);
