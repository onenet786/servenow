const mysql = require('mysql2/promise');
require('dotenv').config();

async function syncMissingTransactions() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'servenow',
    port: process.env.DB_PORT || 3306
  });

  console.log('Connected to database. Checking for missing financial transactions...');

  // 1. Sync Missing Payment Vouchers (CPV)
  const [cpvs] = await connection.execute(`
    SELECT cpv.* 
    FROM cash_payment_vouchers cpv
    LEFT JOIN financial_transactions ft ON ft.reference_id = cpv.voucher_number
    WHERE ft.id IS NULL AND (cpv.status = 'approved' OR cpv.status = 'paid')
  `);

  console.log(`Found ${cpvs.length} missing Payment Vouchers (CPV). Syncing...`);

  for (const v of cpvs) {
    const transaction_number = `FIN-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}-SYNC`;
    
    await connection.execute(`
      INSERT INTO financial_transactions 
      (transaction_number, transaction_type, category, description, amount, payment_method, related_entity_type, related_entity_id, reference_type, reference_id, created_by, created_at, status)
      VALUES (?, 'expense', 'payment', ?, ?, ?, ?, ?, 'payment_voucher', ?, ?, ?, 'completed')
    `, [
      transaction_number,
      v.description || v.purpose || `Payment to ${v.payee_name}`,
      v.amount,
      v.payment_method || 'cash',
      v.payee_type,
      v.payee_id,
      v.voucher_number,
      v.approved_by || 1, // Default to admin if null
      v.created_at
    ]);
    console.log(`Synced CPV: ${v.voucher_number}`);
  }

  // 2. Sync Missing Receipt Vouchers (CRV)
  const [crvs] = await connection.execute(`
    SELECT crv.* 
    FROM cash_receipt_vouchers crv
    LEFT JOIN financial_transactions ft ON ft.reference_id = crv.voucher_number
    WHERE ft.id IS NULL AND (crv.status = 'approved' OR crv.status = 'received')
  `);

  console.log(`Found ${crvs.length} missing Receipt Vouchers (CRV). Syncing...`);

  for (const v of crvs) {
    const transaction_number = `FIN-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}-SYNC`;
    
    await connection.execute(`
      INSERT INTO financial_transactions 
      (transaction_number, transaction_type, category, description, amount, payment_method, related_entity_type, related_entity_id, reference_type, reference_id, created_by, created_at, status)
      VALUES (?, 'income', 'receipt', ?, ?, ?, ?, ?, 'receipt_voucher', ?, ?, ?, 'completed')
    `, [
      transaction_number,
      v.description || `Receipt from ${v.payer_name}`,
      v.amount,
      v.payment_method || 'cash',
      v.payer_type,
      v.payer_id,
      v.voucher_number,
      v.approved_by || 1,
      v.created_at
    ]);
    console.log(`Synced CRV: ${v.voucher_number}`);
  }

  // 3. Sync Missing Rider Cash Movements (RCM - cash_submission only)
  const [rcms] = await connection.execute(`
    SELECT rcm.* 
    FROM rider_cash_movements rcm
    LEFT JOIN financial_transactions ft ON ft.reference_id = rcm.movement_number
    WHERE ft.id IS NULL AND rcm.status = 'approved' AND rcm.movement_type = 'cash_submission'
  `);

  console.log(`Found ${rcms.length} missing Rider Cash Submissions. Syncing...`);

  for (const m of rcms) {
    const transaction_number = `FIN-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}-SYNC`;
    
    // Fetch Rider Name
    const [riders] = await connection.execute('SELECT first_name, last_name FROM riders WHERE id = ?', [m.rider_id]);
    const riderName = riders.length > 0 ? `${riders[0].first_name} ${riders[0].last_name}` : `Rider #${m.rider_id}`;

    await connection.execute(`
      INSERT INTO financial_transactions 
      (transaction_number, transaction_type, category, description, amount, payment_method, related_entity_type, related_entity_id, reference_type, reference_id, created_by, created_at, status)
      VALUES (?, 'income', 'rider_cash', ?, ?, 'cash', 'rider', ?, 'rider_cash_movement', ?, ?, ?, 'completed')
    `, [
      transaction_number,
      m.description || `Cash submission via ${m.movement_number}`,
      m.amount,
      m.rider_id,
      m.movement_number,
      m.approved_by || 1,
      m.approved_at || m.created_at
    ]);
    console.log(`Synced RCM: ${m.movement_number}`);
  }

  console.log('Sync complete.');
  await connection.end();
}

syncMissingTransactions().catch(console.error);
