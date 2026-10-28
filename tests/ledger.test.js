const test = require('node:test');
const assert = require('node:assert');
const { fakeDb } = require('./helpers');
const ledger = require('../services/ledger');

// Source rows for one cash order from a credit store (item 1000, store owed 900,
// delivery fee 150), the rider's collection, a pickup payment, a cash submission,
// a bulk historical store payment and a customer top-up.
function sourceDb(overrides = {}) {
  const rows = {
    stores: [{ id: 5, name: 'Test Store', payment_term: 'Credit with Discount' }],
    orders: [{ id: 10, order_number: 'Ord1', payment_method: 'cash', total_amount: '1150.00', delivery_fee: '150.00', journal_date: '2026-10-01' }],
    items: [{ order_id: 10, store_id: 5, item_value: '1000.00', store_payable: '900.00' }],
    orderStores: [{ order_id: 10, store_id: 5 }],
    wallet: [
      { id: 1, type: 'credit', amount: '1150.00', description: 'Cash collection for order #Ord1', reference_type: 'order', reference_id: '10', journal_date: '2026-10-01', user_type: 'rider', user_id: null, rider_id: 3 },
      { id: 2, type: 'debit', amount: '400.00', description: 'Paid to pickup-paid store Renamed Shop for order #Ord1', reference_type: 'order', reference_id: '10', journal_date: '2026-10-01', user_type: 'rider', user_id: null, rider_id: 3 },
      { id: 3, type: 'credit', amount: '500.00', description: 'Top-up via card', reference_type: 'topup', reference_id: 'pi_1', journal_date: '2026-10-02', user_type: 'customer', user_id: 42, rider_id: null },
    ],
    movements: [{ id: 7, movement_number: 'RCM-1', rider_id: 3, movement_type: 'cash_submission', amount: '750.00', reference_type: null, description: '', journal_date: '2026-10-02', wallet_direction: 'debit' }],
    vouchers: [{ id: 40, voucher_number: 'CPV-40', payee_type: 'expense', payee_id: null, payee_name: 'Historical Cash Store Purchase Adjustment', purpose: 'Cash store purchase adjustment', amount: '300.00', payment_method: 'cash', journal_date: '2026-10-03' }],
    ...overrides,
  };
  return fakeDb((q) => {
    if (/FROM stores$/.test(q) || /SELECT id, name, payment_term FROM stores/.test(q)) return [rows.stores];
    if (/FROM orders o WHERE o.status = 'delivered'/.test(q)) return [rows.orders];
    if (/AS item_value/.test(q)) return [rows.items];
    if (/SELECT DISTINCT oi.order_id/.test(q)) return [rows.orderStores];
    if (/FROM wallet_transactions wt JOIN wallets w/.test(q)) return [rows.wallet];
    if (/FROM rider_cash_movements rcm WHERE rcm.status IN/.test(q)) return [rows.movements];
    if (/FROM cash_payment_vouchers/.test(q)) return [rows.vouchers];
    return [[]];
  }).db;
}

const byKey = (journals) => Object.fromEntries(journals.map((j) => [j.key, j]));
const sum = (lines) => lines.reduce((s, l) => s + l.cents, 0);
const amountOn = (j, account) => j.lines.filter((l) => l.account === account).reduce((s, l) => s + l.cents, 0);

test('every built journal balances to the paisa', async () => {
  const journals = await ledger.buildAllJournals(sourceDb());
  assert.ok(journals.length >= 5);
  for (const j of journals) assert.equal(sum(j.lines), 0, `${j.key} does not balance`);
});

test('delivered order: revenue on delivery, store payable, commission and delivery fee', async () => {
  const j = byKey(await ledger.buildAllJournals(sourceDb()))['order:10'];
  assert.equal(amountOn(j, '1150'), 115000);   // cash to be collected by the rider
  assert.equal(amountOn(j, '2000'), -90000);   // owed to the store
  assert.equal(amountOn(j, '4000'), -10000);   // commission = 1000 - 900
  assert.equal(amountOn(j, '4100'), -15000);   // delivery fee income
  assert.equal(j.date, '2026-10-01');
});

test('rider collection clears against the order; submission moves cash to the office', async () => {
  const js = byKey(await ledger.buildAllJournals(sourceDb()));
  assert.equal(amountOn(js['wallet_transaction:1'], '1100'), 115000);
  assert.equal(amountOn(js['wallet_transaction:1'], '1150'), -115000);
  assert.equal(amountOn(js['rider_cash_movement:7'], '1000'), 75000);
  assert.equal(amountOn(js['rider_cash_movement:7'], '1100'), -75000);
});

test('pickup payment to a renamed store falls back to the order\'s pickup-paid store', async () => {
  const j = byKey(await ledger.buildAllJournals(sourceDb()))['wallet_transaction:2'];
  const storeLine = j.lines.find((l) => l.account === '2000');
  assert.ok(storeLine, 'payment should reduce store payables, not go to suspense');
  assert.equal(storeLine.entityId, '5');
});

test('wallet top-up is a liability, not income', async () => {
  const j = byKey(await ledger.buildAllJournals(sourceDb()))['wallet_transaction:3'];
  assert.equal(amountOn(j, '2100'), -50000);
  assert.ok(!j.lines.some((l) => ledger.ACCOUNT_TYPES[l.account] === 'income'));
});

test('bulk historical store payment reduces store payables (unallocated), not expenses', async () => {
  const j = byKey(await ledger.buildAllJournals(sourceDb()))['payment_voucher:40'];
  const debit = j.lines.find((l) => l.cents > 0);
  assert.equal(debit.account, '2000');
  assert.equal(debit.entityId, null);
});

test('order whose total differs from items + fee books the difference to order adjustments', async () => {
  const db = sourceDb({ orders: [{ id: 10, order_number: 'Ord1', payment_method: 'cash', total_amount: '1140.00', delivery_fee: '150.00', journal_date: '2026-10-01' }] });
  const j = byKey(await ledger.buildAllJournals(db))['order:10'];
  assert.equal(amountOn(j, '4050'), 1000); // 10 less collected than items + fee
  assert.equal(sum(j.lines), 0);
});

test('expense classification', () => {
  assert.equal(ledger.expenseAccount('Salaries'), '5100');
  assert.equal(ledger.expenseAccount('RENT'), '5200');
  assert.equal(ledger.expenseAccount('Internet EXP'), '5300');
  assert.equal(ledger.expenseAccount('Bike Maintenance EXP'), '5400');
  assert.equal(ledger.expenseAccount('Office EXP Adjustment'), '5600');
  assert.equal(ledger.expenseAccount('Manual cash reconciliation'), '3900');
  assert.equal(ledger.expenseAccount('Something else'), '5900');
});
