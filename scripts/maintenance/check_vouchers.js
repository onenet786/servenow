const mysql = require('mysql2/promise');

async function check() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'servenow',
    port: 3306
  });

  const vouchers = ['CPV-20260205-2RD71Z', 'CPV-20260205-DXEW33', 'CPV-20260205-XICU0Q', 'CPV-20260204-53HN35'];
  const quotedVouchers = vouchers.map(v => `'${v}'`).join(',');

  console.log('Searching for vouchers:', quotedVouchers);

  console.log('\n--- Checking cash_payment_vouchers ---');
  const [cpvs] = await connection.execute(`SELECT * FROM cash_payment_vouchers WHERE voucher_number IN (${quotedVouchers})`);
  console.log(JSON.stringify(cpvs, null, 2));

  console.log('\n--- Checking financial_transactions ---');
  const [fts] = await connection.execute(`SELECT * FROM financial_transactions WHERE reference_id IN (${quotedVouchers})`);
  console.log(JSON.stringify(fts, null, 2));
  
  await connection.end();
}

check().catch(console.error);
