require('dotenv').config();

const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const statusOnly = args.includes('--status-only');
const createdByArg = args.find((arg) => arg.startsWith('--created-by='));
const createdBy = createdByArg ? Number(createdByArg.split('=')[1]) || null : null;
const dbArgNames = new Set([
  '--db-url',
  '--host',
  '--port',
  '--user',
  '--password',
  '--database',
]);
const dbArgs = {};
for (const arg of args) {
  if (!arg.startsWith('--')) continue;
  const [name, ...valueParts] = arg.split('=');
  if (dbArgNames.has(name)) dbArgs[name.slice(2)] = valueParts.join('=');
}
const orderNumbers = args.filter((arg) => !arg.startsWith('--'));

function usage() {
  console.log(`
Usage:
  node scripts/mark_orders_paid.js [--apply] [--status-only] [--created-by=<user_id>] <order_number>...

Examples:
  node scripts/mark_orders_paid.js Ord2605060026 Ord2605060024
  node scripts/mark_orders_paid.js --apply Ord2605060026 Ord2605060024
  node scripts/mark_orders_paid.js --apply --status-only Ord2605060026 Ord2605060024

Connection options, without editing .env:
  $env:DB_HOST='66.163.118.125'; $env:DB_PORT='3306'; $env:DB_USER='...'; $env:DB_PASSWORD='...'; $env:DB_NAME='servenow'; node scripts/mark_orders_paid.js --apply Ord2605060026 Ord2605060024

Or:
  $env:DATABASE_URL='mysql://USER:PASSWORD@HOST:3306/servenow'; node scripts/mark_orders_paid.js --apply Ord2605060026 Ord2605060024

Or pass DB values directly so they override .env:
  node scripts/mark_orders_paid.js --apply --host=66.163.118.125 --port=3306 --user=USER --password=PASSWORD --database=servenow Ord2605060026 Ord2605060024

Default mode is dry-run. Add --apply to write changes.
`);
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function connect() {
  const url = dbArgs.url || process.env.DATABASE_URL || process.env.DB_URL || process.env.MYSQL_URL;
  if (url) return mysql.createConnection(url);

  return mysql.createConnection({
    host: dbArgs.host || process.env.DB_HOST || 'localhost',
    user: dbArgs.user || process.env.DB_USER || 'root',
    password: dbArgs.password || process.env.DB_PASSWORD || '',
    database: dbArgs.database || process.env.DB_NAME || 'servenow',
    port: Number(dbArgs.port || process.env.DB_PORT || 3306),
  });
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Number(rows[0]?.cnt || 0) > 0;
}

async function generateFinancialTransactionNumber(conn) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  const [rows] = await conn.execute(
    'SELECT COUNT(*) AS count FROM financial_transactions WHERE DATE(created_at) = CURDATE()'
  );
  const count = Number(rows[0]?.count || 0) + 1;
  const randomStr = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `FIN-${dateStr}-${String(count).padStart(3, '0')}-${randomStr}`;
}

async function insertFinancialTransaction(conn, data) {
  const [existing] = await conn.execute(
    `SELECT id
     FROM financial_transactions
     WHERE reference_type = ? AND reference_id = ? AND category = ?
     LIMIT 1`,
    [data.reference_type, data.reference_id, data.category]
  );
  if (existing.length > 0) return existing[0].id;

  const transactionNumber = await generateFinancialTransactionNumber(conn);
  const [result] = await conn.execute(
    `INSERT INTO financial_transactions
     (transaction_number, transaction_type, category, description, amount, payment_method,
      related_entity_type, related_entity_id, reference_type, reference_id, notes, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    [
      transactionNumber,
      data.transaction_type,
      data.category,
      data.description,
      data.amount,
      data.payment_method || 'cash',
      data.related_entity_type || null,
      data.related_entity_id || null,
      data.reference_type,
      data.reference_id,
      data.notes || null,
      createdBy,
    ]
  );
  return result.insertId;
}

async function ensureRiderWalletCredit(conn, order) {
  if (!order.rider_id) return;

  const amount = money(order.total_amount);
  if (amount <= 0) return;

  const [existingTx] = await conn.execute(
    `SELECT wt.id
     FROM wallet_transactions wt
     JOIN wallets w ON w.id = wt.wallet_id
     WHERE w.rider_id = ? AND wt.reference_type = 'order' AND wt.reference_id = ? AND wt.type = 'credit'
     LIMIT 1`,
    [order.rider_id, order.id]
  );
  if (existingTx.length > 0) return;

  const [wallets] = await conn.execute(
    'SELECT id, balance FROM wallets WHERE rider_id = ? LIMIT 1',
    [order.rider_id]
  );

  let walletId;
  let balance = 0;
  if (wallets.length > 0) {
    walletId = wallets[0].id;
    balance = money(wallets[0].balance);
  } else {
    const [created] = await conn.execute(
      'INSERT INTO wallets (rider_id, user_type, balance) VALUES (?, ?, ?)',
      [order.rider_id, 'rider', 0]
    );
    walletId = created.insertId;
  }

  const balanceAfter = money(balance + amount);
  await conn.execute(
    'UPDATE wallets SET balance = ?, total_credited = total_credited + ? WHERE id = ?',
    [balanceAfter, amount, walletId]
  );
  await conn.execute(
    `INSERT INTO wallet_transactions
     (wallet_id, type, amount, description, reference_type, reference_id, balance_after)
     VALUES (?, 'credit', ?, ?, 'order', ?, ?)`,
    [
      walletId,
      amount,
      `Cash collection for order #${order.order_number}`,
      order.id,
      balanceAfter,
    ]
  );
}

async function ensureRiderCashMovement(conn, order) {
  if (!order.rider_id) return;
  if (!(await tableExists(conn, 'rider_cash_movements'))) return;

  const [existing] = await conn.execute(
    `SELECT id
     FROM rider_cash_movements
     WHERE movement_type = 'cash_collection' AND reference_type = 'order' AND reference_id = ?
     LIMIT 1`,
    [order.id]
  );
  if (existing.length > 0) return;

  const movementDate = new Date().toISOString().split('T')[0];
  const dateStr = movementDate.replace(/-/g, '');
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  const movementNumber = `RCM-${dateStr}-${randomStr}`;

  await conn.execute(
    `INSERT INTO rider_cash_movements
     (movement_number, rider_id, movement_date, movement_type, amount, description,
      reference_type, reference_id, status, recorded_by)
     VALUES (?, ?, ?, 'cash_collection', ?, ?, 'order', ?, 'completed', ?)`,
    [
      movementNumber,
      order.rider_id,
      movementDate,
      money(order.total_amount),
      `Cash collection for Order #${order.order_number}`,
      order.id,
      createdBy,
    ]
  );
}

async function ensureFinancialRows(conn, order) {
  if (!(await tableExists(conn, 'financial_transactions'))) return;

  const orderTotal = money(order.total_amount);
  const deliveryFee = money(order.delivery_fee);
  const storeAmount = money(orderTotal - deliveryFee);

  await insertFinancialTransaction(conn, {
    transaction_type: 'adjustment',
    category: 'store_payable',
    description: `Store Credit for Order #${order.order_number}`,
    amount: storeAmount,
    payment_method: order.payment_method,
    related_entity_type: 'store',
    related_entity_id: order.store_id,
    reference_type: 'order',
    reference_id: order.id,
    notes: 'Store payable recorded when cash payment was marked paid.',
  });

  await insertFinancialTransaction(conn, {
    transaction_type: 'income',
    category: 'order_revenue',
    description: `Total Revenue for Order #${order.order_number}`,
    amount: orderTotal,
    payment_method: order.payment_method,
    related_entity_type: 'rider',
    related_entity_id: order.rider_id,
    reference_type: 'order',
    reference_id: order.id,
    notes: `Gross income: ${orderTotal}`,
  });

  await insertFinancialTransaction(conn, {
    transaction_type: 'adjustment',
    category: 'rider_receivable',
    description: `Rider Debit for Order #${order.order_number}`,
    amount: orderTotal,
    payment_method: order.payment_method,
    related_entity_type: 'rider',
    related_entity_id: order.rider_id,
    reference_type: 'order',
    reference_id: order.id,
    notes: `Rider cash balance: ${orderTotal}`,
  });
}

async function main() {
  if (orderNumbers.length === 0) {
    usage();
    process.exit(2);
  }

  const conn = await connect();
  try {
    const placeholders = orderNumbers.map(() => '?').join(', ');
    const [orders] = await conn.execute(
      `SELECT id, order_number, store_id, rider_id, status, payment_status, payment_method, total_amount, delivery_fee
       FROM orders
       WHERE order_number IN (${placeholders})
       ORDER BY order_number`,
      orderNumbers
    );

    console.log(`Found ${orders.length}/${orderNumbers.length} orders.`);
    for (const order of orders) {
      console.log(
        `${order.order_number}: status=${order.status}, payment_status=${order.payment_status}, method=${order.payment_method}, total=${money(order.total_amount)}`
      );
    }

    const found = new Set(orders.map((order) => order.order_number));
    const missing = orderNumbers.filter((orderNumber) => !found.has(orderNumber));
    if (missing.length > 0) {
      console.log(`Missing orders: ${missing.join(', ')}`);
    }

    const candidates = orders.filter((order) => {
      return String(order.status || '').toLowerCase() === 'delivered' &&
        String(order.payment_method || '').toLowerCase() === 'cash' &&
        String(order.payment_status || '').toLowerCase() !== 'paid';
    });

    console.log(`Eligible delivered cash orders to mark paid: ${candidates.length}`);

    if (!apply) {
      console.log('Dry-run only. Re-run with --apply to write changes.');
      return;
    }

    await conn.beginTransaction();
    for (const order of candidates) {
      await conn.execute(
        "UPDATE orders SET payment_status = 'paid' WHERE id = ?",
        [order.id]
      );

      if (!statusOnly) {
        await ensureRiderWalletCredit(conn, order);
        await ensureRiderCashMovement(conn, order);
        await ensureFinancialRows(conn, order);
      }

      console.log(`Marked paid: ${order.order_number}`);
    }
    await conn.commit();
    console.log('Done.');
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      // ignore rollback failures
    }
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('Failed:', error && error.message ? error.message : error);
  process.exit(1);
});
