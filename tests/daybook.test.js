const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers');
const { daybook, REPORTS } = require('../services/reportsCentre');

// Two stores: a cash store (owed cost price) and a credit store (owed price less its 10% discount).
function daybookDb() {
  const stores = [
    { id: 1, name: 'Cash Bakery', payment_term: 'Cash Only', store_discount_percent: 0, store_discount_apply_all_products: 0, commission_rate: 0, payment_grace_days: 0, is_active: 1 },
    { id: 2, name: 'Credit Mart', payment_term: 'Credit with Discount', store_discount_percent: 10, store_discount_apply_all_products: 1, commission_rate: 0, payment_grace_days: 0, is_active: 1 },
  ];
  const item = (id, orderId, storeId, day, value, payable) => ({
    id, order_id: orderId, order_number: `Ord${orderId}`, store_id: storeId, quantity: 1, price: value, item_value: value,
    store_payable: payable, settlement_id: null, payment_status: 'paid',
    order_created_ts: `${day} 10:00:00`, order_updated_ts: `${day} 12:00:00`, manual_product: 0,
  });
  const items = [
    item(1, 101, 1, '2026-11-02', 500, 400), // cash: sale 500, cost 400
    item(2, 101, 2, '2026-11-02', 1000, 900), // same order, credit store: 10% off
    item(3, 102, 2, '2026-11-02', 300, 270),
    item(4, 103, 2, '2026-11-01', 800, 720), // the day before: outside the daybook
  ];
  const settlements = [{
    id: 9, settlement_number: 'SET-9', store_id: 2, status: 'paid', settlement_date: '2026-11-02',
    paid_ts: '2026-11-02 18:00:00', created_ts: '2026-11-02 17:00:00', total_orders_amount: 720, commissions: 0,
    deductions: 0, net_amount: 720, payment_method: 'cash', notes: '', settlement_kind: 'manual', credit_applied: 0, linked_items: 0,
  }];
  const vouchers = [{ id: 5, voucher_number: 'CPV-5', store_id: 1, payee_name: 'Cash Bakery', purpose: 'Bread', amount: 400, payment_method: 'cash', status: 'paid', voucher_date: '2026-11-02' }];
  // The balance reset journal is not a payment; a normal journal on the store account is.
  const journals = [
    { id: 30, voucher_number: 'JV-RESET-20261102', voucher_date: '2026-11-02', account_name: 'Store payables', store_id: '2', entry_type: 'debit', amount: 99999 },
    { id: 31, voucher_number: 'JV-0031', voucher_date: '2026-11-02', account_name: 'Store payables', store_id: '2', entry_type: 'debit', amount: 50 },
  ];
  // Customer totals include the delivery fee; 102 was paid from the wallet; 104 is a delivery-fee-only order.
  const delivered = [
    { id: 101, total_amount: 1600, delivery_fee: 100, method: 'cash', updated: '2026-11-03' },
    { id: 102, total_amount: 400, delivery_fee: 100, method: 'wallet', updated: '2026-11-02' },
    { id: 103, total_amount: 900, delivery_fee: 100, method: 'cash', updated: '2026-11-01' },
    { id: 104, total_amount: 100, delivery_fee: 100, method: 'cash', updated: '2026-11-02' },
  ];
  const collected = [{ order_id: '101', first_collect: '2026-11-02' }]; // collected on the 2nd, edited later
  const fuel = [{ id: 77, date: '2026-11-02', fuel_cost: 350, distance: 40, rider: 'Ali Raza' }];
  const { db, log } = fakeDb((q, params) => {
    if (/information_schema/.test(q)) return [[{ cnt: 1 }]];
    if (/SELECT id, name, payment_term, store_discount_percent/.test(q)) return [stores];
    if (/SELECT id, name, payment_term FROM stores/.test(q)) return [stores];
    if (/AS store_payable/.test(q)) return [items];
    if (/FROM store_settlements ss/.test(q)) return [settlements];
    if (/FROM cash_payment_vouchers/.test(q)) return [vouchers];
    if (/FROM journal_vouchers jv/.test(q)) return [journals];
    if (/FROM orders o WHERE o.status = 'delivered'/.test(q)) return [delivered];
    if (q.includes("'%Y-%m-%d') AS first_collect")) return [collected]; // not the store-account query (has the time)
    if (/FROM riders_fuel_history/.test(q)) return [fuel.filter((e) => e.date >= params[0] && `${e.date} 00:00:00` <= params[1])];
    return undefined;
  });
  return { db, log };
}

test('daybook: purchase (cash and credit) minus paid including fuel', async () => {
  const { db } = daybookDb();
  const r = await daybook(db, { from: '2026-11-02', to: '2026-11-02' });
  const [summary, cash, orders, stores, payments] = r.sections;

  assert.equal(summary.rows.length, 1);
  const day = summary.rows[0];
  assert.equal(day.sale, 1800);
  assert.equal(day.discount, 230);
  assert.equal(day.cash_purchase, 400);
  assert.equal(day.credit_purchase, 1170);
  assert.equal(day.purchase, 1570);
  assert.equal(day.paid_other, 1170); // settlement 720 + voucher 400 + journal 50; the reset is left out
  assert.equal(day.fuel, 350);
  assert.equal(day.paid, 1520);
  assert.equal(day.difference, 50);
  assert.equal(summary.totals.orders, 2);

  // With delivery charges: what customers paid, less wallet, less everything paid out.
  const c = cash.rows[0];
  assert.match(cash.title, /delivery charges/);
  assert.deepEqual([c.orders, c.sale, c.delivery, c.customer_total, c.not_cash, c.cash, c.paid, c.to_receive, c.owed_credit, c.earning],
    [3, 1800, 300, 2100, 400, 1700, 1520, 180, 1170, 180]);
  assert.equal(c.sale, day.sale); // ties to the purchase summary

  // Order-wise: one line per order and store; sale less discount is the purchase.
  assert.deepEqual(orders.rows.map((o) => [o.order_number, o.store, o.kind, o.purchase]),
    [['Ord101', 'Cash Bakery', 'Cash', 400], ['Ord101', 'Credit Mart', 'Credit', 900], ['Ord102', 'Credit Mart', 'Credit', 270]]);
  assert.ok(orders.rows.every((o) => Math.abs(o.sale - o.discount - o.purchase) < 0.001));

  // Store-wise ties to the summary, and the payment list adds up to total paid.
  assert.equal(stores.totals.purchase, day.purchase);
  assert.equal(stores.totals.paid + day.fuel, day.paid);
  const credit = stores.rows.find((s) => s.store === 'Credit Mart');
  assert.deepEqual([credit.orders, credit.sale, credit.discount, credit.purchase, credit.paid, credit.difference], [2, 1300, 130, 1170, 770, 400]);
  assert.equal(payments.totals.amount, day.paid);
  assert.ok(payments.rows.some((p) => p.type === 'Fuel charges' && p.paid_to === 'Ali Raza' && p.amount === 350));
  assert.match(r.notes[0], /minus total paid/);
  assert.ok(!payments.rows.some((p) => /RESET/.test(p.reference)));
  assert.ok(r.notes.some((n) => /balance reset journal \(Rs 99,999\.00/.test(n)));
});

test('daybook: no dates means today; one store leaves fuel out', async () => {
  const { db, log } = daybookDb();
  const today = await daybook(db, {}, { today: '2026-11-01' });
  assert.deepEqual(today.sections[0].rows.map((d) => d.date), ['2026-11-01']);
  assert.equal(today.sections[0].rows[0].purchase, 720);

  const before = log.filter((q) => /riders_fuel_history/.test(q)).length;
  const one = await daybook(db, { from: '2026-11-02', to: '2026-11-02', storeId: 2 });
  assert.equal(log.filter((q) => /riders_fuel_history/.test(q)).length, before);
  assert.equal(one.sections[0].rows[0].fuel, 0);
  assert.match(one.notes[0], /fuel left out/);
  assert.equal(one.sections[1].rows[0].orders, 2); // only orders with that store's items
});

test('daybook is listed in Reports Centre under Accounts with a store filter', () => {
  const entry = REPORTS.find((r) => r.key === 'daybook');
  assert.equal(entry.group, 'Accounts');
  assert.deepEqual(entry.filters, ['store']);
});
