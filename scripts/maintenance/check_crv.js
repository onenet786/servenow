const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const vouchers = ['CRV-20260205-M6HAMO', 'CRV-20260205-J2N9G4', 'CRV-20260205-DH43RC'];
  const quotedVouchers = vouchers.map(v => `'${v}'`).join(',');

  console.log('Searching for CRVs:', quotedVouchers);
  const [crvs] = await connection.execute(`SELECT * FROM cash_receipt_vouchers WHERE voucher_number IN (${quotedVouchers})`);
  console.log(JSON.stringify(crvs, null, 2));

  console.log('Checking financial_transactions for these CRVs:');
  const [fts] = await connection.execute(`SELECT * FROM financial_transactions WHERE reference_id IN (${quotedVouchers})`);
  console.log(JSON.stringify(fts, null, 2));
  
  await connection.end();
}

check().catch(console.error);
