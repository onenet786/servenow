const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const voucher = 'CPR-06Feb2026-0001';
  console.log('Fetching period for report:', voucher);
  const [reports] = await connection.execute('SELECT period_from, period_to FROM financial_reports WHERE report_number = ?', [voucher]);
  
  if (reports.length === 0) {
      console.log('Report not found');
      process.exit();
  }

  const { period_from, period_to } = reports[0];
  console.log('Period:', period_from, 'to', period_to);

  console.log('Checking transactions within this period:');
  const [txns] = await connection.execute('SELECT * FROM financial_transactions WHERE created_at BETWEEN ? AND ?', [period_from, period_to]);
  console.log(`Found ${txns.length} transactions.`);
  if (txns.length > 0) {
      console.log('First 2 transactions:', JSON.stringify(txns.slice(0, 2), null, 2));
  } else {
      console.log('No transactions found in this range. Checking wider range...');
      const [allTxns] = await connection.execute('SELECT created_at FROM financial_transactions ORDER BY created_at DESC LIMIT 5');
      console.log('Latest 5 transactions dates:', JSON.stringify(allTxns, null, 2));
  }
  
  await connection.end();
}

check().catch(console.error);
