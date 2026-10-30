// Reports Centre: read-only reports behind admin > Reports Centre.
//
// Each report returns { columns, rows, totals, notes }. Money comes from the same
// sources the books use: rider wallets (utils/riderCash), store accounts
// (utils/storeAccount) and the general ledger, so reports cannot disagree.
//
// Dates are YYYY-MM-DD and inclusive.

const riderCash = require('../utils/riderCash');
const storeAccount = require('../utils/storeAccount');

const money = (key, label) => ({ key, label, type: 'money' });
const text = (key, label) => ({ key, label });
const count = (key, label) => ({ key, label, type: 'number' });
const date = (key, label) => ({ key, label, type: 'date' });

const round = (value) => Math.round(Number(value || 0) * 100) / 100;
const fromCents = (cents) => Math.round(cents) / 100;
const inRange = (day, from, to) => (!from || day >= from) && (!to || day <= to);

function totalsOf(rows, keys) {
  const totals = {};
  for (const key of keys) totals[key] = round(rows.reduce((sum, r) => sum + Number(r[key] || 0), 0));
  return totals;
}

const dateClause = (column, { from, to }, params) => {
  let sql = '';
  if (from) { sql += ` AND ${column} >= ?`; params.push(from); }
  if (to) { sql += ` AND ${column} <= ?`; params.push(`${to} 23:59:59`); }
  return sql;
};

// ---------------------------------------------------------------------------
// Riders

async function riderCashPosition(db, f) {
  const rows = (await riderCash.riderCashPositions(db, { riderId: f.riderId, from: f.from, to: f.to }))
    .filter((r) => ['opening', 'collected', 'handed_in', 'closing', 'reset'].some((k) => Math.abs(r[k]) > 0.004));
  const keys = ['opening', 'collected', 'fees', 'paid_stores', 'fuel', 'advances', 'handed_in', 'cancelled', 'adjustments', 'corrections', 'reset', 'closing'];
  return {
    columns: [
      text('name', 'Rider'), money('opening', 'Opening'), money('collected', 'Collected'), money('fees', 'Fees'),
      money('paid_stores', 'Paid to Stores'), money('fuel', 'Fuel'), money('advances', 'Advances'),
      money('handed_in', 'Handed In'), money('cancelled', 'Cancelled Orders'), money('adjustments', 'Adjustments'),
      money('corrections', 'Corrections'), money('reset', 'Reset'), money('closing', 'Closing'),
    ],
    rows,
    totals: totalsOf(rows, keys),
    notes: ['Closing is what the rider should be holding. With no end date it equals the rider wallet.'],
  };
}

async function handInTracker(db, f) {
  const params = [];
  let where = dateClause('rcm.movement_date', f, params);
  if (f.riderId) { where += ' AND rcm.rider_id = ?'; params.push(f.riderId); }
  const [rows] = await db.query(
    `SELECT rcm.movement_number, DATE_FORMAT(rcm.movement_date, '%Y-%m-%d') AS date,
            TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS rider,
            rcm.amount, rcm.status, COALESCE(rcm.description, '') AS description,
            (SELECT COUNT(*) FROM rider_cash_submission_orders o WHERE o.movement_id = rcm.id) AS orders,
            TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS recorded_by,
            TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, ''))) AS approved_by,
            DATE_FORMAT(rcm.approved_at, '%Y-%m-%d') AS approved_on,
            DATEDIFF(CURDATE(), rcm.movement_date) AS age
     FROM rider_cash_movements rcm
     JOIN riders r ON r.id = rcm.rider_id
     LEFT JOIN users u ON u.id = rcm.recorded_by
     LEFT JOIN users a ON a.id = rcm.approved_by
     WHERE rcm.movement_type = 'cash_submission' AND COALESCE(rcm.reference_type, '') <> 'balance_reset' ${where}
     ORDER BY rcm.movement_date DESC, rcm.id DESC`,
    params
  );
  const sumStatus = (...statuses) => round(rows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + Number(r.amount), 0));
  return {
    columns: [
      date('date', 'Date'), text('movement_number', 'Reference'), text('rider', 'Rider'), money('amount', 'Amount'),
      text('status', 'Status'), count('orders', 'Orders'), count('age', 'Days Old'), text('recorded_by', 'Recorded By'),
      text('approved_by', 'Approved By'), date('approved_on', 'Approved On'), text('description', 'Details'),
    ],
    rows,
    totals: { amount: sumStatus('approved', 'completed') },
    notes: [
      `Approved Rs ${sumStatus('approved', 'completed').toFixed(2)}, pending Rs ${sumStatus('pending').toFixed(2)}, cancelled Rs ${sumStatus('cancelled').toFixed(2)}. The total counts approved only.`,
    ],
  };
}

async function riderDailyTally(db, f) {
  const entries = await riderCash.loadRiderWalletEntries(db, { riderId: f.riderId });
  const [riders] = await db.query(
    `SELECT r.id, TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS name, COALESCE(w.balance, 0) AS balance
     FROM riders r LEFT JOIN wallets w ON w.rider_id = r.id`
  );
  const names = new Map(riders.map((r) => [Number(r.id), r.name]));
  const days = new Map();
  const running = new Map();
  for (const e of entries) {
    const rider = Number(e.rider_id);
    running.set(rider, (running.get(rider) || 0) + e.cents);
    const key = `${e.date}|${rider}`;
    if (!days.has(key)) days.set(key, { date: e.date, rider: names.get(rider) || `Rider ${rider}`, collected: 0, paid_stores: 0, fuel: 0, handed_in: 0, other: 0, closing: 0 });
    const day = days.get(key);
    if (e.heading === 'collected') day.collected += e.cents;
    else if (e.heading === 'paid_stores') day.paid_stores -= e.cents;
    else if (e.heading === 'fuel') day.fuel -= e.cents;
    else if (e.heading === 'handed_in') day.handed_in -= e.cents;
    else day.other += e.cents;
    day.closing = running.get(rider);
    day.rider_id = rider;
  }
  // A little old history never reached the entries, so day ends carry it too.
  const carried = new Map(riders.map((r) => [Number(r.id), Math.round(Number(r.balance) * 100) - (running.get(Number(r.id)) || 0)]));
  for (const day of days.values()) day.closing += carried.get(day.rider_id) || 0;
  const rows = [...days.values()]
    .filter((d) => inRange(d.date, f.from, f.to))
    .sort((a, b) => b.date.localeCompare(a.date) || a.rider.localeCompare(b.rider))
    .map((d) => ({ ...d, collected: fromCents(d.collected), paid_stores: fromCents(d.paid_stores), fuel: fromCents(d.fuel), handed_in: fromCents(d.handed_in), other: fromCents(d.other), closing: fromCents(d.closing) }));
  return {
    columns: [
      date('date', 'Date'), text('rider', 'Rider'), money('collected', 'Collected'), money('paid_stores', 'Paid to Stores'),
      money('fuel', 'Fuel'), money('handed_in', 'Handed In'), money('other', 'Other'), money('closing', 'Wallet at Day End'),
    ],
    rows,
    totals: totalsOf(rows, ['collected', 'paid_stores', 'fuel', 'handed_in', 'other']),
    notes: ['Other includes advances, adjustments, cancelled orders, delivery fees and the balance reset.'],
  };
}

async function fuelVsDistance(db, f) {
  const params = [];
  let where = dateClause('fh.entry_date', f, params);
  if (f.riderId) { where += ' AND fh.rider_id = ?'; params.push(f.riderId); }
  const [rows] = await db.query(
    `SELECT TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS rider,
            COUNT(*) AS entries, ROUND(SUM(fh.distance), 2) AS km, ROUND(SUM(fh.fuel_cost), 2) AS cost,
            ROUND(SUM(fh.fuel_cost) / NULLIF(SUM(fh.distance), 0), 2) AS rate,
            ROUND(SUM(CASE WHEN EXISTS (
              SELECT 1 FROM rider_fuel_payment_entries e
              JOIN rider_cash_movements m ON m.id = e.movement_id
              WHERE e.fuel_history_id = fh.id AND m.status IN ('approved', 'completed')) THEN fh.fuel_cost ELSE 0 END), 2) AS paid
     FROM riders_fuel_history fh
     JOIN riders r ON r.id = fh.rider_id
     WHERE 1=1 ${where}
     GROUP BY fh.rider_id, r.first_name, r.last_name
     ORDER BY cost DESC`,
    params
  );
  const out = rows.map((r) => ({ ...r, unpaid: round(Number(r.cost) - Number(r.paid)) }));
  return {
    columns: [
      text('rider', 'Rider'), count('entries', 'Entries'), count('km', 'Km'), money('cost', 'Fuel Cost'), money('rate', 'Cost per Km'),
      money('paid', 'Paid from Rider Cash'), money('unpaid', 'Not Paid Through System'),
    ],
    rows: out,
    totals: totalsOf(out, ['entries', 'km', 'cost', 'paid', 'unpaid']),
    notes: [`Fuel logged before ${riderCash.FUEL_RULE_START} was never paid through the system and is with the accounts.`],
  };
}

// ---------------------------------------------------------------------------
// Stores

async function loadPositions(db, f) {
  const { accounts } = await storeAccount.loadStoreAccounts(db, { storeId: f.storeId || null });
  return [...accounts.values()].map((account) => ({ account, position: storeAccount.accountPosition(account) }));
}

async function payablesAgeing(db, f) {
  const rows = (await loadPositions(db, f))
    .filter(({ position }) => position.balance_c !== 0)
    .map(({ account, position }) => ({
      store: account.name,
      term: account.payment_term || 'Not set',
      balance: fromCents(position.balance_c),
      d0_7: fromCents(position.aging.d0_7),
      d8_15: fromCents(position.aging.d8_15),
      d16_30: fromCents(position.aging.d16_30),
      d30_plus: fromCents(position.aging.d30_plus),
      oldest: position.oldest_unpaid,
      days: position.days_outstanding,
    }))
    .sort((a, b) => b.balance - a.balance);
  return {
    columns: [
      text('store', 'Store'), text('term', 'Payment Term'), money('balance', 'Owed'), money('d0_7', '0-7 Days'), money('d8_15', '8-15 Days'),
      money('d16_30', '16-30 Days'), money('d30_plus', 'Over 30 Days'), date('oldest', 'Oldest Unpaid'), count('days', 'Days'),
    ],
    rows,
    totals: totalsOf(rows, ['balance', 'd0_7', 'd8_15', 'd16_30', 'd30_plus']),
    notes: [],
  };
}

const PAYMENT_TYPES = { settlement: 'Settlement', on_account: 'On account', pickup: 'Rider at pickup', voucher: 'Payment voucher', receipt: 'Receipt from store', journal: 'Journal voucher' };

async function storePaymentRegister(db, f) {
  const rows = [];
  for (const { account } of await loadPositions(db, f)) {
    for (const p of account.payments) {
      if (f.excludePickup && p.type === 'pickup') continue;
      if (!inRange(p.date, f.from, f.to)) continue;
      rows.push({ date: p.date, store: account.name, type: PAYMENT_TYPES[p.type] || p.type, reference: p.ref, method: p.method, amount: fromCents(p.amount_c) });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.store.localeCompare(b.store));
  return {
    columns: [date('date', 'Date'), text('store', 'Store'), text('type', 'Type'), text('reference', 'Reference'), text('method', 'Method'), money('amount', 'Amount')],
    rows,
    totals: totalsOf(rows, ['amount']),
    notes: ['Journal voucher lines include the 30 Oct 2026 balance reset.'],
  };
}

async function pickupPayments(db, f) {
  const { payments } = await storeAccount.loadRiderPickupPayments(db);
  const [stores] = await db.query('SELECT id, name FROM stores');
  const [riders] = await db.query(`SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM riders`);
  const storeNames = new Map(stores.map((s) => [Number(s.id), s.name]));
  const riderNames = new Map(riders.map((r) => [Number(r.id), r.name]));
  const rows = payments
    .filter((p) => inRange(p.date, f.from, f.to) && (!f.riderId || Number(p.rider_id) === Number(f.riderId)) && (!f.storeId || Number(p.store_id) === Number(f.storeId)))
    .map((p) => ({ date: p.date, store: storeNames.get(Number(p.store_id)) || `Store ${p.store_id}`, rider: riderNames.get(Number(p.rider_id)) || `Rider ${p.rider_id}`, order_id: p.order_id, amount: fromCents(p.amount_c), kind: p.reversal ? 'Reversed' : 'Paid' }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    columns: [date('date', 'Date'), text('store', 'Store'), text('rider', 'Rider'), text('order_id', 'Order ID'), text('kind', 'Type'), money('amount', 'Amount')],
    rows,
    totals: totalsOf(rows, ['amount']),
    notes: [],
  };
}

// Cash stores are paid at pickup, so anything open here means a payment was not recorded.
async function cashStoreLines(db, f) {
  const lines = [];
  for (const { account, position } of await loadPositions(db, f)) {
    if (!account.pickup_paid) continue;
    for (const open of position.open_lines) {
      if (open.due_c <= 0 || !inRange(open.line.date, f.from, f.to)) continue;
      lines.push({ date: open.line.date, store: account.name, term: account.payment_term, order_number: open.line.order_number, amount: fromCents(open.due_c) });
    }
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date));
}

async function cashStoreCheck(db, f) {
  const rows = await cashStoreLines(db, f);
  return {
    columns: [date('date', 'Date'), text('store', 'Store'), text('term', 'Payment Term'), text('order_number', 'Order'), money('amount', 'Payment Missing')],
    rows,
    totals: totalsOf(rows, ['amount']),
    notes: ['Cash stores are paid by the rider at pickup, so this list should be empty. Each row is an order where that payment was not recorded.'],
  };
}

// ---------------------------------------------------------------------------
// Accounts

async function glLines(db, accountSql, f, extra = '') {
  const params = [];
  const where = dateClause('j.journal_date', f, params);
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(j.journal_date, '%Y-%m-%d') AS date, j.source_type, j.source_id, j.description, l.account_code,
            l.debit, l.credit, l.memo
     FROM gl_lines l
     JOIN gl_journals j ON j.id = l.journal_id
     WHERE ${accountSql} ${where} ${extra}
     ORDER BY j.journal_date, l.id`,
    params
  );
  return rows;
}

async function dailyCashBook(db, f) {
  const [[before]] = await db.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS opening
     FROM gl_lines l JOIN gl_journals j ON j.id = l.journal_id
     WHERE l.account_code = '1000' ${f.from ? 'AND j.journal_date < ?' : 'AND 1=0'}`,
    f.from ? [f.from] : []
  );
  const days = new Map();
  for (const l of await glLines(db, "l.account_code = '1000'", f)) {
    if (!days.has(l.date)) days.set(l.date, { date: l.date, cash_in: 0, cash_out: 0 });
    const day = days.get(l.date);
    day.cash_in += Number(l.debit);
    day.cash_out += Number(l.credit);
  }
  let balance = Number(before.opening);
  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
    const opening = balance;
    balance += d.cash_in - d.cash_out;
    return { date: d.date, opening: round(opening), cash_in: round(d.cash_in), cash_out: round(d.cash_out), closing: round(balance), flag: balance < -0.004 ? 'Negative' : '' };
  });
  return {
    columns: [date('date', 'Date'), money('opening', 'Opening'), money('cash_in', 'Cash In'), money('cash_out', 'Cash Out'), money('closing', 'Closing'), text('flag', 'Check')],
    rows: rows.reverse(),
    totals: totalsOf(rows, ['cash_in', 'cash_out']),
    notes: ['Office cash can never really be negative. A negative day means cash came in that was not recorded, or a payment is wrong.'],
  };
}

async function suspenseReview(db, f) {
  const lines = await glLines(db, "l.account_code = '3900'", f);
  const rows = lines.map((l) => ({ date: l.date, source: l.source_type, reference: l.source_id, description: l.memo || l.description, debit: round(l.debit), credit: round(l.credit) })).reverse();
  return {
    columns: [date('date', 'Date'), text('source', 'Source'), text('reference', 'Reference'), text('description', 'Details'), money('debit', 'Debit'), money('credit', 'Credit')],
    rows,
    totals: totalsOf(rows, ['debit', 'credit']),
    notes: ['Everything here needs an accountant decision. Each entry should be moved to a real account.'],
  };
}

async function monthlyProfitLoss(db, f) {
  const months = new Map();
  for (const l of await glLines(db, "(l.account_code LIKE '4%' OR l.account_code LIKE '5%')", f)) {
    const month = l.date.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, commission: 0, delivery: 0, other_income: 0, expenses: 0 });
    const m = months.get(month);
    const net = Number(l.credit) - Number(l.debit);
    if (l.account_code === '4000') m.commission += net;
    else if (l.account_code === '4100') m.delivery += net;
    else if (l.account_code.startsWith('4')) m.other_income += net;
    else m.expenses -= net;
  }
  const rows = [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).map((m) => ({
    month: m.month, commission: round(m.commission), delivery: round(m.delivery), other_income: round(m.other_income),
    income: round(m.commission + m.delivery + m.other_income), expenses: round(m.expenses),
    profit: round(m.commission + m.delivery + m.other_income - m.expenses),
  }));
  return {
    columns: [text('month', 'Month'), money('commission', 'Commission'), money('delivery', 'Delivery Fees'), money('other_income', 'Other Income'), money('income', 'Total Income'), money('expenses', 'Expenses'), money('profit', 'Profit')],
    rows,
    totals: totalsOf(rows, ['commission', 'delivery', 'other_income', 'income', 'expenses', 'profit']),
    notes: ['Before any Suspense entries are cleared. They may reduce this profit.'],
  };
}

async function expensesByCategory(db, f) {
  const [accounts] = await db.query("SELECT code, name FROM gl_accounts WHERE code LIKE '5%'");
  const names = new Map(accounts.map((a) => [a.code, a.name]));
  const groups = new Map();
  for (const l of await glLines(db, "l.account_code LIKE '5%'", f)) {
    const key = `${l.date.slice(0, 7)}|${l.account_code}`;
    if (!groups.has(key)) groups.set(key, { month: l.date.slice(0, 7), category: names.get(l.account_code) || l.account_code, amount: 0 });
    groups.get(key).amount += Number(l.debit) - Number(l.credit);
  }
  const rows = [...groups.values()].map((g) => ({ ...g, amount: round(g.amount) })).sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount);
  return {
    columns: [text('month', 'Month'), text('category', 'Category'), money('amount', 'Amount')],
    rows,
    totals: totalsOf(rows, ['amount']),
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Control

async function exceptionsReport(db, f) {
  const rows = [];
  const add = (type, reference, details, amount) => rows.push({ type, reference, details, amount: round(amount) });

  const [wallets] = await db.query(
    `SELECT TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS rider, w.balance
     FROM wallets w JOIN riders r ON r.id = w.rider_id WHERE w.balance < -0.004`);
  wallets.forEach((w) => add('Rider wallet below zero', w.rider, 'Rider cannot hold less than nothing. Check their last entries.', w.balance));

  const [[cash]] = await db.query(`SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM gl_lines WHERE account_code = '1000'`);
  if (Number(cash.balance) < -0.004) add('Office cash below zero', 'Account 1000', 'Cash came in that was not recorded, or a payment is wrong.', cash.balance);

  const [[suspense]] = await db.query(`SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM gl_lines WHERE account_code = '3900'`);
  if (Math.abs(Number(suspense.balance)) > 0.004) add('Suspense not cleared', 'Account 3900', 'Needs an accountant decision. See Suspense Review.', suspense.balance);

  for (const table of [['cash_receipt_vouchers', 'Receipt'], ['cash_payment_vouchers', 'Payment']]) {
    const [drafts] = await db.query(
      `SELECT voucher_number, amount, DATEDIFF(CURDATE(), voucher_date) AS age
       FROM ${table[0]} WHERE status IN ('draft', 'pending') AND DATEDIFF(CURDATE(), voucher_date) > 7`);
    drafts.forEach((d) => add(`${table[1]} voucher not finished`, d.voucher_number, `${d.age} days old. Approve it only if the money really moved, otherwise cancel it.`, d.amount));
  }

  const [handIns] = await db.query(
    `SELECT rcm.movement_number, rcm.amount, DATEDIFF(CURDATE(), rcm.movement_date) AS age,
            TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS rider
     FROM rider_cash_movements rcm JOIN riders r ON r.id = rcm.rider_id
     WHERE rcm.movement_type = 'cash_submission' AND rcm.status = 'pending' AND DATEDIFF(CURDATE(), rcm.movement_date) > 2`);
  handIns.forEach((h) => add('Hand-in waiting for approval', h.movement_number, `${h.rider}, ${h.age} days old.`, h.amount));

  for (const line of await cashStoreLines(db, {})) add('Cash store payment missing', line.order_number, `${line.store}: the rider's payment at pickup was not recorded.`, line.amount);

  const [emptyOrders] = await db.query(
    `SELECT o.order_number, o.total_amount FROM orders o
     WHERE o.status = 'delivered' AND o.total_amount > 0 AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)`);
  emptyOrders.forEach((o) => add('Delivered order with no items', o.order_number, 'No store can be credited for this order.', o.total_amount));

  const [fuel] = await db.query(
    `SELECT fh.id, fh.entry_date, fh.fuel_cost, fh.distance, TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS rider, a.rate
     FROM riders_fuel_history fh
     JOIN riders r ON r.id = fh.rider_id
     JOIN (SELECT rider_id, SUM(fuel_cost) / NULLIF(SUM(distance), 0) AS rate FROM riders_fuel_history
           WHERE entry_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND distance > 0 GROUP BY rider_id) a ON a.rider_id = fh.rider_id
     WHERE fh.entry_date >= ? AND fh.distance > 0 AND fh.fuel_cost / fh.distance > a.rate * ?`,
    [riderCash.FUEL_RULE_START, riderCash.FUEL_RATE_LIMIT]);
  fuel.forEach((e) => add('Fuel above normal rate', `Entry ${e.id}`, `${e.rider}: Rs ${(e.fuel_cost / e.distance).toFixed(2)} per km, average Rs ${Number(e.rate).toFixed(2)}.`, e.fuel_cost));

  return {
    columns: [text('type', 'Check'), text('reference', 'Reference'), text('details', 'What to do'), money('amount', 'Amount')],
    rows,
    totals: {},
    notes: [rows.length ? `${rows.length} item(s) need attention.` : 'Nothing needs attention.'],
  };
}

async function changeLog(db, f) {
  const sources = [
    ['Hand-in or rider cash', `SELECT rcm.movement_number AS reference, rcm.amount, rcm.status, rcm.updated_at AS changed_at, COALESCE(rcm.approved_by, rcm.recorded_by) AS user_id
      FROM rider_cash_movements rcm WHERE rcm.movement_type NOT IN ('cash_collection', 'store_payment')`],
    ['Receipt voucher', `SELECT voucher_number, amount, status, updated_at, COALESCE(received_by, approved_by, prepared_by) FROM cash_receipt_vouchers WHERE 1=1`],
    ['Payment voucher', `SELECT voucher_number, amount, status, updated_at, COALESCE(paid_by, approved_by, prepared_by) FROM cash_payment_vouchers WHERE 1=1`],
    ['Store settlement', `SELECT settlement_number, net_amount, status, updated_at, NULL FROM store_settlements WHERE 1=1`],
    ['Expense', `SELECT expense_number, amount, status, updated_at, COALESCE(approved_by, submitted_by) FROM admin_expenses WHERE 1=1`],
    ['Journal voucher', `SELECT voucher_number, total_amount, status, COALESCE(posted_at, created_at), COALESCE(approved_by, prepared_by) FROM journal_vouchers WHERE 1=1`],
  ];
  const rows = [];
  const [users] = await db.query(`SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM users WHERE user_type IN ('admin', 'standard_user')`);
  const names = new Map(users.map((u) => [Number(u.id), u.name]));
  for (const [type, sql] of sources) {
    let found;
    try {
      [found] = await db.query(`SELECT * FROM (${sql}) t`);
    } catch (err) {
      if (err.errno === 1054 || err.errno === 1146) continue; // column or table not on this database
      throw err;
    }
    for (const r of found) {
      const values = Object.values(r);
      const when = values[3] instanceof Date ? values[3] : new Date(values[3]);
      const day = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
      if (!inRange(day, f.from, f.to)) continue;
      rows.push({ date: day, time: when.toTimeString().slice(0, 5), type, reference: values[0], amount: round(values[1]), status: values[2], by: names.get(Number(values[4])) || '' });
    }
  }
  rows.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return {
    columns: [date('date', 'Date'), text('time', 'Time'), text('type', 'Record'), text('reference', 'Reference'), money('amount', 'Amount'), text('status', 'Status'), text('by', 'By')],
    rows: rows.slice(0, 2000),
    totals: {},
    notes: ['Shows the last change to each record and who approved or recorded it. Latest 2,000 only: use dates to narrow it.'],
  };
}

// ---------------------------------------------------------------------------
// Sales

function salesReport(group, label) {
  const groups = {
    store: { select: `COALESCE(s.name, 'No store')`, order: 'net DESC' },
    day: { select: `DATE_FORMAT(o.created_at, '%Y-%m-%d')`, order: 'label DESC' },
    hour: { select: `LPAD(HOUR(o.created_at), 2, '0')`, order: 'label ASC' },
    payment: { select: `LOWER(COALESCE(o.payment_method, 'unknown'))`, order: 'net DESC' },
  };
  return async (db, f) => {
    const params = [];
    let where = dateClause('o.created_at', f, params);
    if (f.storeId) { where += ' AND o.store_id = ?'; params.push(f.storeId); }
    const [rows] = await db.query(
      `SELECT ${groups[group].select} AS label,
              COUNT(*) AS orders,
              SUM(o.status = 'delivered') AS delivered,
              SUM(o.status = 'cancelled') AS cancelled,
              ROUND(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount ELSE 0 END), 2) AS net,
              ROUND(SUM(CASE WHEN o.status = 'delivered' THEN COALESCE(o.delivery_fee, 0) ELSE 0 END), 2) AS fees,
              ROUND(SUM(CASE WHEN o.status = 'cancelled' THEN o.total_amount ELSE 0 END), 2) AS lost
       FROM orders o
       LEFT JOIN stores s ON s.id = o.store_id
       WHERE 1=1 ${where}
       GROUP BY label
       ORDER BY ${groups[group].order}`,
      params
    );
    const out = rows.map((r) => ({
      ...r,
      average: Number(r.delivered) ? round(Number(r.net) / Number(r.delivered)) : 0,
      cancel_rate: Number(r.orders) ? round((Number(r.cancelled) * 100) / Number(r.orders)) : 0,
    }));
    return {
      columns: [
        text('label', label), count('orders', 'Orders'), count('delivered', 'Delivered'), count('cancelled', 'Cancelled'), count('cancel_rate', 'Cancelled %'),
        money('net', 'Delivered Sales'), money('fees', 'Delivery Fees'), money('average', 'Average Order'), money('lost', 'Cancelled Value'),
      ],
      rows: out,
      totals: totalsOf(out, ['orders', 'delivered', 'cancelled', 'net', 'fees', 'lost']),
      notes: [],
    };
  };
}

const REPORTS = [
  { key: 'rider-cash-position', group: 'Riders', title: 'Rider Cash Position', filters: ['rider'], run: riderCashPosition },
  { key: 'hand-in-tracker', group: 'Riders', title: 'Hand-in Tracker', filters: ['rider'], run: handInTracker },
  { key: 'rider-daily-tally', group: 'Riders', title: 'Rider Daily Tally', filters: ['rider'], run: riderDailyTally },
  { key: 'fuel-vs-distance', group: 'Riders', title: 'Fuel vs Distance', filters: ['rider'], run: fuelVsDistance },
  { key: 'payables-ageing', group: 'Stores', title: 'Payables Ageing', filters: ['store'], noDates: true, run: payablesAgeing },
  { key: 'store-payment-register', group: 'Stores', title: 'Store Payment Register', filters: ['store'], run: (db, f) => storePaymentRegister(db, { ...f, excludePickup: true }) },
  { key: 'pickup-payments', group: 'Stores', title: 'Pickup Payments', filters: ['rider', 'store'], run: pickupPayments },
  { key: 'cash-store-check', group: 'Stores', title: 'Cash Store Check', filters: ['store'], run: cashStoreCheck },
  { key: 'daily-cash-book', group: 'Accounts', title: 'Daily Cash Book', filters: [], run: dailyCashBook },
  { key: 'suspense-review', group: 'Accounts', title: 'Suspense Review', filters: [], run: suspenseReview },
  { key: 'monthly-profit-loss', group: 'Accounts', title: 'Monthly Profit & Loss', filters: [], run: monthlyProfitLoss },
  { key: 'expenses-by-category', group: 'Accounts', title: 'Expenses by Category', filters: [], run: expensesByCategory },
  { key: 'exceptions', group: 'Control', title: 'Exceptions Report', filters: [], noDates: true, run: exceptionsReport },
  { key: 'change-log', group: 'Control', title: 'Change Log', filters: [], run: changeLog },
  { key: 'sales-by-store', group: 'Sales', title: 'Sales by Store', filters: ['store'], run: salesReport('store', 'Store') },
  { key: 'sales-by-day', group: 'Sales', title: 'Sales by Day', filters: ['store'], run: salesReport('day', 'Day') },
  { key: 'sales-by-hour', group: 'Sales', title: 'Sales by Hour', filters: ['store'], run: salesReport('hour', 'Hour') },
  { key: 'sales-by-payment', group: 'Sales', title: 'Sales by Payment Type', filters: ['store'], run: salesReport('payment', 'Payment Type') },
];

module.exports = { REPORTS };
