const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, request } = require('./helpers');
const sa = require('../utils/storeAccount');
const fin = require('../routes/financial');

// A credit store (10% discount) shaped like the Amir Bashir case:
//  - Jun: two orders (payable 900 + 450) then a lump-sum settlement of 1,350 with no order lines
//  - Oct 6: a settlement that links the June orders again plus one new order (payable 270): pays 1,620
//  - Oct 18: a lump sum of 500 with no order lines
//  - Oct 20/22: two new orders (payable 180 + 360), not linked to anything
function storeRaw() {
  const item = (id, orderId, ts, value, payable, settlementId = null) => ({
    id, order_id: orderId, order_number: `Ord${orderId}`, store_id: 48, quantity: 1, price: value, item_value: String(value),
    store_payable: String(payable), settlement_id: settlementId, payment_status: 'paid',
    order_created_ts: ts, order_updated_ts: ts, manual_product: 0,
  });
  const settlement = (id, number, paidTs, total, commissions, net, linked, extra = {}) => ({
    id, settlement_number: number, store_id: 48, status: 'paid', settlement_date: paidTs.slice(0, 10), paid_ts: paidTs, created_ts: paidTs,
    total_orders_amount: String(total), commissions: String(commissions), deductions: '0.00', net_amount: String(net),
    payment_method: 'cash', notes: '', settlement_kind: null, credit_applied: '0.00', linked_items: linked, ...extra,
  });
  return {
    stores: [{ id: 48, name: 'Amir Bashir Naan Shop', payment_term: 'Credit with Discount', store_discount_percent: '10.00', store_discount_apply_all_products: 1, payment_grace_days: 10, is_active: 1 }],
    items: [
      item(1, 101, '2026-06-06 10:00:00', 1000, 900, 294),
      item(2, 102, '2026-06-10 10:00:00', 500, 450, 294),
      item(3, 103, '2026-09-30 10:00:00', 300, 270, 294),
      item(4, 104, '2026-10-20 10:00:00', 200, 180),
      item(5, 105, '2026-10-22 10:00:00', 400, 360),
    ],
    collections: [],
    settlements: [
      settlement(188, 'SS-LUMP-JUNE', '2026-06-15 20:00:00', 0, 0, 1350, 0),
      settlement(294, 'SS-OCT-06', '2026-10-06 11:00:00', 1800, 180, 1620, 3),
      settlement(300, 'SS-OCT-18', '2026-10-18 12:00:00', 0, 0, 500, 0),
    ],
    vouchers: [], receipts: [], journals: [], pickupPayments: [], unidentifiedPickupPayments: [], riderStorePayments: [],
  };
}

test('store balance = payable of delivered lines - all payments (negative = store credit)', () => {
  const account = sa.buildAccounts(storeRaw()).get(48);
  const p = sa.accountPosition(account, { today: '2026-10-30' });
  assert.equal(p.payable_c, 216000);           // 900 + 450 + 270 + 180 + 360
  assert.equal(p.paid_c, 347000);              // 1350 + 1620 + 500
  assert.equal(p.balance_c, -131000);          // store has 1,310 credit
  assert.equal(p.settled_payable_c, 162000);   // lines linked to SS-OCT-06
  assert.equal(p.credit_c, 185000);            // payments not matched to settled lines
  // Both open orders (540) are covered by the credit, nothing is due
  assert.equal(p.open_payable_c, 54000);
  assert.equal(p.covered_c, 54000);
  assert.equal(p.unsettled_c, 0);
  assert.equal(p.credit_left_c, 131000);       // equals -balance: consistent
  assert.equal(p.overdue, false);
});

test('without credit, open lines are due and age against the grace days', () => {
  const raw = storeRaw();
  raw.settlements = raw.settlements.filter((s) => s.id === 294);
  const account = sa.buildAccounts(raw).get(48);
  const p = sa.accountPosition(account, { today: '2026-11-05' });
  assert.equal(p.balance_c, 54000);
  assert.equal(p.unsettled_c, 54000);
  assert.equal(p.unsettled_orders, 2);
  assert.equal(p.oldest_unpaid, '2026-10-20');
  assert.equal(p.days_outstanding, 16);
  assert.equal(p.overdue, true);               // 16 days > 10 grace days
  assert.deepEqual(p.aging, { d0_7: 0, d8_15: 36000, d16_30: 18000, d30_plus: 0 });
});

test('store credit is consumed exactly once when covered lines are linked later', () => {
  const raw = storeRaw();
  const before = sa.accountPosition(sa.buildAccounts(raw).get(48));
  // Link the two open lines to a new settlement that used 540 of credit (net 0)
  raw.settlements.push({ ...raw.settlements[2], id: 400, settlement_number: 'SS-NEW', status: 'pending', total_orders_amount: '600', commissions: '60', net_amount: '0', credit_applied: '540', linked_items: 2, settlement_kind: 'orders' });
  raw.items[3].settlement_id = 400;
  raw.items[4].settlement_id = 400;
  const after = sa.accountPosition(sa.buildAccounts(raw).get(48));
  assert.equal(after.balance_c, before.balance_c);       // linking moves no money
  assert.equal(after.credit_c, before.credit_c - 54000);  // credit used once
  assert.equal(after.covered_c, 0);
  assert.equal(after.unsettled_c, 0);
});

test('statement runs chronologically and closes at the balance', () => {
  const account = sa.buildAccounts(storeRaw()).get(48);
  const st = sa.accountStatement(account, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(st.opening_c, 216000 - 54000 - 135000);  // June + Sep orders less the June lump sum
  assert.equal(st.closing_c, -131000);
  assert.deepEqual(st.entries.map((e) => e.type), ['settlement', 'settlement', 'order', 'order']);
  assert.match(st.entries[1].label, /no orders linked/);
  const period = sa.accountPeriod(account, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(period.credit_given_c, 54000);
  assert.equal(period.paid.cash, 212000);
  assert.equal(period.closing_c, -131000);
});

test('flags: unlinked lump sums and the lump sum then linked again (double payment)', () => {
  const account = sa.buildAccounts(storeRaw()).get(48);
  const issues = sa.accountIssues(account);
  assert.equal(issues.store_credit_c, 131000);
  assert.deepEqual(issues.unlinked_payments.map((u) => u.settlement_number), ['SS-LUMP-JUNE', 'SS-OCT-18']);
  assert.equal(issues.net_mismatches.length, 0);
  assert.equal(issues.double_payments.length, 1);
  const d = issues.double_payments[0];
  assert.equal(d.settlement_number, 'SS-OCT-06');
  assert.equal(d.double_paid_c, 135000);        // the June lump sum paid those lines already
  assert.deepEqual(d.lump_payments, [{ ref: 'SS-LUMP-JUNE', amount_c: 135000 }]);
  assert.equal(d.items_from, '2026-06-06');
  assert.equal(d.items_to, '2026-06-10');
});

test('credit applied by a settlement is not reported as a double payment, and net must add up', () => {
  const raw = storeRaw();
  raw.settlements[1].credit_applied = '1350.00';
  raw.settlements[1].net_amount = '270.00';
  const issues = sa.accountIssues(sa.buildAccounts(raw).get(48));
  assert.equal(issues.double_payments.length, 0);
  assert.equal(issues.net_mismatches.length, 0);
  raw.settlements[1].net_amount = '300.00';
  const bad = sa.accountIssues(sa.buildAccounts(raw).get(48)).net_mismatches;
  assert.equal(bad.length, 1);
  assert.equal(bad[0].difference_c, 3000);
});

test('pickup payments and vouchers reduce the balance; receipts from the store increase it', () => {
  const raw = storeRaw();
  raw.settlements = [];
  raw.pickupPayments = [{ store_id: 48, id: 7, ts: '2026-10-21 09:00:00', date: '2026-10-21', amount_c: 10000, order_id: '104', rider_id: 3, reversal: false, description: '' }];
  raw.vouchers = [{ id: 1, voucher_number: 'CPV-1', store_id: 48, amount: '200.00', payment_method: 'bank_transfer', voucher_date: '2026-10-25', purpose: '' }];
  raw.receipts = [{ id: 2, voucher_number: 'CRV-2', store_id: 48, amount: '50.00', payment_method: 'cash', voucher_date: '2026-10-26' }];
  const account = sa.buildAccounts(raw).get(48);
  const p = sa.accountPosition(account);
  assert.equal(p.paid_c, 10000 + 20000 - 5000);
  assert.equal(p.balance_c, 216000 - 25000);
  const period = sa.accountPeriod(account, { from: '2026-10-01' });
  assert.equal(period.paid.pickup, 10000);
  assert.equal(period.paid.voucher, 20000);
  assert.equal(period.paid.adjustment, -5000);
});

// ---------------------------------------------------------------------------
// Routes

const admin = { id: 1, user_type: 'admin' };
const staff = { id: 8, user_type: 'standard_user' };

function routeDb(user, { candidates = [], raw = storeRaw() } = {}) {
  const writes = [];
  const { db } = fakeDb((q, params) => {
    if (/FROM users WHERE id = \?/.test(q) && /is_active/.test(q)) return [[{ is_active: 1, user_type: user.user_type }]];
    if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/information_schema\.COLUMNS/.test(q)) return [[{ cnt: 1 }]];
    if (/FROM stores WHERE id = \? FOR UPDATE/.test(q)) return [[{ id: params[0], payment_term: 'Credit with Discount' }]];
    if (/SELECT id, name, payment_term, store_discount_percent/.test(q)) return [raw.stores];
    if (/AS store_payable/.test(q)) return [raw.items];
    if (/first_collect/.test(q)) return [[]];
    if (/FROM store_settlements ss/.test(q) && /linked_items/.test(q)) {
      return [raw.settlements.map((s) => ({ ...s, linked_items: s.linked_items }))];
    }
    if (/AND oi\.settlement_id IS NULL/.test(q)) return [candidates];
    if (/^(INSERT|UPDATE|ALTER)/.test(q)) writes.push({ q, params });
    return undefined;
  });
  return { db, writes };
}

const candidate = (id, orderId, date, price) => ({
  id, order_id: orderId, product_id: 1, quantity: 1, price, variant_label: null, discount_type: null, discount_value: null,
  order_number: `Ord${orderId}`, order_date: date, product_name: 'Naan', commission_rate: 10,
  payment_term: 'Credit with Discount', store_discount_apply_all_products: 1, store_discount_percent: 10,
});

test('unsettled items: lines covered by store credit are shown as covered, nothing due', async () => {
  const { db } = routeDb(admin, { candidates: [candidate(4, 104, '2026-10-20', 200), candidate(5, 105, '2026-10-22', 400)] });
  const res = await request(fin, '/api/financial', db, { path: '/api/financial/store-settlements/unsettled-items?store_id=48', user: admin });
  assert.equal(res.status, 200);
  const { items, summary } = res.body;
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.covered_by_credit === 'full' && i.line_due === 0));
  assert.equal(summary.items_payable, 540);
  assert.equal(summary.credit_applied, 540);
  assert.equal(summary.net_amount, 0);
  assert.equal(summary.store_balance, -1310);
  assert.equal(summary.store_credit, 1310);
  assert.equal(summary.amount_due, 0);
});

test('auto settlement applies store credit once and links the lines it covers', async () => {
  const raw = storeRaw();
  raw.settlements = raw.settlements.filter((s) => s.id !== 300);
  // credit = paid (1350 + 1620) - settled lines (1620) = 1350; the 540 of open lines is covered
  const { db, writes } = routeDb(admin, { raw, candidates: [candidate(4, 104, '2026-10-20', 200), candidate(5, 105, '2026-10-22', 400)] });
  const res = await request(fin, '/api/financial', db, {
    method: 'POST', path: '/api/financial/store-settlements', user: admin,
    body: { store_id: 48, payment_method: 'cash', auto_calculate: true, selected_item_ids: [4, 5] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.settlement.credit_applied, 540);
  assert.equal(res.body.settlement.net_amount, 0);
  assert.equal(res.body.settlement.settlement_kind, 'orders');
  const insert = writes.find((w) => /^INSERT INTO store_settlements/.test(w.q));
  // total, commissions, deductions, net ... kind, credit_applied
  assert.deepEqual(insert.params.slice(5, 9), [600, 60, 0, 0]);
  assert.deepEqual(insert.params.slice(-2), ['orders', 540]);
  const link = writes.find((w) => /^UPDATE order_items SET settlement_id/.test(w.q));
  assert.deepEqual(link.params.slice(1), [4, 5]);
});

test('payment on account: admin records a lump sum with no orders; staff cannot', async () => {
  let ctx = routeDb(admin);
  let res = await request(fin, '/api/financial', ctx.db, {
    method: 'POST', path: '/api/financial/store-settlements', user: admin,
    body: { store_id: 48, payment_method: 'cheque', net_amount: 2052, on_account: true, notes: 'Cash handed over at shop' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.settlement.settlement_kind, 'on_account');
  const insert = ctx.writes.find((w) => /^INSERT INTO store_settlements/.test(w.q));
  assert.deepEqual(insert.params.slice(5, 10), [0, 0, 0, 2052, 'check']);
  assert.ok(!ctx.writes.some((w) => /^UPDATE order_items/.test(w.q)), 'no order lines are linked');

  ctx = routeDb(admin);
  res = await request(fin, '/api/financial', ctx.db, {
    method: 'POST', path: '/api/financial/store-settlements', user: admin,
    body: { store_id: 48, payment_method: 'cash', net_amount: 0, on_account: true },
  });
  assert.equal(res.status, 400);

  ctx = routeDb(staff);
  res = await request(fin, '/api/financial', ctx.db, {
    method: 'POST', path: '/api/financial/store-settlements', user: staff,
    body: { store_id: 48, payment_method: 'cash', net_amount: 500, on_account: true },
  });
  assert.equal(res.status, 403);
});

test('a manual settlement that is not on account must still add up', async () => {
  const { db } = routeDb(admin);
  const res = await request(fin, '/api/financial', db, {
    method: 'POST', path: '/api/financial/store-settlements', user: admin,
    body: { store_id: 48, payment_method: 'cash', net_amount: 2052 },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Payment on account/);
});

test('store payments report and statement return the balance, flags and running balance', async () => {
  const { db } = routeDb(admin);
  let res = await request(fin, '/api/financial', db, { path: '/api/financial/reports/store-payments?from=2026-10-01&to=2026-10-31', user: admin });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.stores.find((s) => s.store_id === 48);
  assert.equal(row.closing_balance, -1310);
  assert.equal(row.balance_status, 'store_credit');
  assert.equal(row.credit_given, 540);
  assert.equal(row.paid_cash, 2120);
  assert.equal(row.covered_by_credit, 540);
  assert.equal(res.body.flags.double_payments[0].double_paid, 1350);
  assert.equal(res.body.flags.unlinked_payments.length, 2);

  res = await request(fin, '/api/financial', db, { path: '/api/financial/reports/store-payments/48/statement?from=2026-10-01', user: admin });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.statement.opening_balance, 270);
  assert.equal(res.body.statement.closing_balance, -1310);
  assert.equal(res.body.open_orders.length, 2);
  assert.ok(res.body.open_orders.every((o) => o.status === 'covered'));

  res = await request(fin, '/api/financial', db, { path: '/api/financial/reports/store-payments?from=2026-10-31&to=2026-10-01', user: admin });
  assert.equal(res.status, 400);
});
